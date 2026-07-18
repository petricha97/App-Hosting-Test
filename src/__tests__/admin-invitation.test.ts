// @vitest-environment node
/**
 * M8-T1 — src/lib/db/adminInvitation.ts. Spec:
 * agents/docs/specs/m8-real-iam.md §3/D7/D10.
 *
 * Locks:
 *  - deterministic (org, email) doc id — re-inviting the same pair is an
 *    UPSERT (spec §3 AC-1): exactly one doc, the SECOND call's
 *    role/token/expiresAt win
 *  - inviting an email that is already an active member of THIS org is
 *    rejected before any write (spec §3 AC-2); a member of a DIFFERENT org
 *    is unaffected (spec §3 AC-3)
 *  - D10: only an Owner may invite/revoke someone as/at "admin" — an Admin
 *    caller gets HIERARCHY_VIOLATION
 *  - revoke is idempotent: revoking an already-accepted/-revoked invitation
 *    is a no-op success (spec §3 AC-6)
 *  - expiry is DERIVED (expiresAt < now), never a stored status
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const {
  INVITATION_EXPIRY_DAYS,
  invitationId,
  isAdminInvitationExpired,
  createOrUpdateAdminInvitation,
  getAdminInvitationForOrganization,
  getAdminInvitationByToken,
  listAdminInvitationsForOrganization,
  revokeAdminInvitation,
} = await import("@/lib/db/adminInvitation");
const { organizationMemberId } =
  await import("@/lib/db/adminOrganizationMember");

const ORG_A = "org-a";
const ORG_B = "org-b";

function seedOrgMember(
  organizationId: string,
  email: string,
  role: "owner" | "admin" | "editor" | "viewer",
): void {
  const lower = email.toLowerCase();
  fake.store.set(
    `OrganizationMember/${organizationMemberId(organizationId, lower)}`,
    {
      organizationId,
      email: lower,
      role,
      name: lower,
      status: "active",
    },
  );
}

beforeEach(() => {
  fake.reset();
});

describe("invitationId", () => {
  it("is deterministic for the same (org, email) tuple", () => {
    const a = invitationId(ORG_A, "Person@Example.com");
    const b = invitationId(ORG_A, "person@example.com");
    expect(a).toBe(b);
  });

  it("differs across organizations and across emails", () => {
    expect(invitationId(ORG_A, "x@example.com")).not.toBe(
      invitationId(ORG_B, "x@example.com"),
    );
    expect(invitationId(ORG_A, "x@example.com")).not.toBe(
      invitationId(ORG_A, "y@example.com"),
    );
  });
});

describe("isAdminInvitationExpired", () => {
  it("is false for a future expiresAt and true for a past one", () => {
    const future = Timestamp.fromMillis(Date.now() + 60_000);
    const past = Timestamp.fromMillis(Date.now() - 60_000);
    expect(isAdminInvitationExpired({ expiresAt: future as never })).toBe(
      false,
    );
    expect(isAdminInvitationExpired({ expiresAt: past as never })).toBe(true);
  });
});

describe("createOrUpdateAdminInvitation", () => {
  it("rejects a non-manager caller", async () => {
    seedOrgMember(ORG_A, "editor@example.com", "editor");

    const result = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "editor@example.com",
      email: "new@example.com",
      role: "viewer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CALLER_NOT_AUTHORIZED");
  });

  it("rejects a caller who isn't a member of this org at all", async () => {
    const result = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "ghost@example.com",
      email: "new@example.com",
      role: "viewer",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CALLER_NOT_AUTHORIZED");
  });

  it("D10: an Admin caller inviting role 'admin' gets HIERARCHY_VIOLATION", async () => {
    seedOrgMember(ORG_A, "admin@example.com", "admin");

    const result = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      email: "new@example.com",
      role: "admin",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("HIERARCHY_VIOLATION");
  });

  it("an Admin caller inviting role 'editor' or 'viewer' succeeds", async () => {
    seedOrgMember(ORG_A, "admin@example.com", "admin");

    const editorInvite = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      email: "editor-invitee@example.com",
      role: "editor",
    });
    expect(editorInvite.ok).toBe(true);

    const viewerInvite = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      email: "viewer-invitee@example.com",
      role: "viewer",
    });
    expect(viewerInvite.ok).toBe(true);
  });

  it("an Owner caller inviting role 'admin' succeeds", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");

    const result = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "future-admin@example.com",
      role: "admin",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invitation.role).toBe("admin");
    expect(result.invitation.status).toBe("pending");
  });

  it("rejects inviting an email that is already an active member of THIS org — zero write (spec §3 AC-2)", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");
    seedOrgMember(ORG_A, "existing@example.com", "viewer");

    const result = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "existing@example.com",
      role: "editor",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ALREADY_MEMBER");

    const found = await getAdminInvitationForOrganization({
      organizationId: ORG_A,
      email: "existing@example.com",
    });
    expect(found).toBeNull();
  });

  it("succeeds for an email that is a member of a DIFFERENT org (spec §3 AC-3)", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");
    seedOrgMember(ORG_B, "elsewhere@example.com", "owner");

    const result = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "elsewhere@example.com",
      role: "editor",
    });
    expect(result.ok).toBe(true);
  });

  it("upsert: two sequential invites for the same (org, email) result in exactly ONE doc, second call wins (spec §3 AC-1)", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");

    const first = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "carlos@economist.com",
      role: "admin",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);

    const second = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "carlos@economist.com",
      role: "editor",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.invitation.id).toBe(first.invitation.id);
    expect(second.invitation.role).toBe("editor");
    expect(second.invitation.token).not.toBe(first.invitation.token);

    const all = await listAdminInvitationsForOrganization(ORG_A);
    const matching = all.filter((inv) => inv.email === "carlos@economist.com");
    expect(matching).toHaveLength(1);
    expect(matching[0].role).toBe("editor");
  });

  it("expiresAt is set INVITATION_EXPIRY_DAYS out from now", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");

    const result = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "someone@example.com",
      role: "viewer",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expiresMs = (
      result.invitation.expiresAt as unknown as Timestamp
    ).toMillis();
    const expectedMs =
      Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresMs - expectedMs)).toBeLessThan(5_000);
  });
});

describe("getAdminInvitationByToken", () => {
  it("resolves an invitation by its bearer token", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");
    const created = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "token-lookup@example.com",
      role: "viewer",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await getAdminInvitationByToken(created.invitation.token);
    expect(found?.id).toBe(created.invitation.id);
  });

  it("returns null for an unknown token", async () => {
    expect(await getAdminInvitationByToken("not-a-real-token")).toBeNull();
  });
});

describe("revokeAdminInvitation", () => {
  it("rejects a non-manager caller", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");
    await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "revoke-target@example.com",
      role: "viewer",
    });
    seedOrgMember(ORG_A, "viewer@example.com", "viewer");

    const result = await revokeAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "viewer@example.com",
      email: "revoke-target@example.com",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CALLER_NOT_AUTHORIZED");
  });

  it("returns NOT_FOUND for a non-existent invitation", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");

    const result = await revokeAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "nobody@example.com",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NOT_FOUND");
  });

  it("D10: an Admin caller revoking a pending Admin-role invite gets HIERARCHY_VIOLATION", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");
    await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "future-admin@example.com",
      role: "admin",
    });
    seedOrgMember(ORG_A, "admin@example.com", "admin");

    const result = await revokeAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      email: "future-admin@example.com",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("HIERARCHY_VIOLATION");
  });

  it("idempotency wins over D10: an Admin caller revoking an already-ACCEPTED Admin-role invite is a 200 no-op, not HIERARCHY_VIOLATION", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");
    const created = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "already-accepted-admin@example.com",
      role: "admin",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    seedOrgMember(ORG_A, "admin@example.com", "admin");

    // Simulate a prior accept — status is no longer "pending".
    fake.store.set(`Invitation/${created.invitation.id}`, {
      ...created.invitation,
      status: "accepted",
    });

    const result = await revokeAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      email: "already-accepted-admin@example.com",
    });
    expect(result.ok).toBe(true);

    const found = await getAdminInvitationForOrganization({
      organizationId: ORG_A,
      email: "already-accepted-admin@example.com",
    });
    // Untouched — still "accepted", never overwritten to "revoked".
    expect(found?.status).toBe("accepted");
  });

  it("idempotency wins over D10: an Admin caller revoking an already-REVOKED Admin-role invite is a 200 no-op, not HIERARCHY_VIOLATION", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");
    const created = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "already-revoked-admin@example.com",
      role: "admin",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    seedOrgMember(ORG_A, "admin@example.com", "admin");

    // Simulate a prior revoke — status is no longer "pending".
    fake.store.set(`Invitation/${created.invitation.id}`, {
      ...created.invitation,
      status: "revoked",
    });

    const result = await revokeAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      email: "already-revoked-admin@example.com",
    });
    expect(result.ok).toBe(true);
  });

  it("revokes a pending invitation", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");
    await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "revoke-me@example.com",
      role: "viewer",
    });

    const result = await revokeAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "revoke-me@example.com",
    });
    expect(result.ok).toBe(true);

    const found = await getAdminInvitationForOrganization({
      organizationId: ORG_A,
      email: "revoke-me@example.com",
    });
    expect(found?.status).toBe("revoked");
  });

  it("is idempotent: revoking an already-accepted invitation is a 200 no-op, not an error (spec §3 AC-6)", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");
    const created = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "already-accepted@example.com",
      role: "viewer",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Simulate a prior accept (directly, bypassing acceptAdminInvitation —
    // this test only exercises revoke's own idempotency contract).
    fake.store.set(`Invitation/${created.invitation.id}`, {
      ...created.invitation,
      status: "accepted",
    });

    const result = await revokeAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "already-accepted@example.com",
    });
    expect(result.ok).toBe(true);

    const found = await getAdminInvitationForOrganization({
      organizationId: ORG_A,
      email: "already-accepted@example.com",
    });
    // Untouched — still "accepted", never overwritten to "revoked".
    expect(found?.status).toBe("accepted");
  });

  it("is idempotent: revoking an already-revoked invitation is a 200 no-op", async () => {
    seedOrgMember(ORG_A, "owner@example.com", "owner");
    await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "twice-revoked@example.com",
      role: "viewer",
    });
    const first = await revokeAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "twice-revoked@example.com",
    });
    expect(first.ok).toBe(true);

    const second = await revokeAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "twice-revoked@example.com",
    });
    expect(second.ok).toBe(true);
  });
});
