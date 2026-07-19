// @vitest-environment node
/**
 * M8-T1 — src/lib/db/adminUserOrganization.ts's real-IAM additions. Spec:
 * agents/docs/specs/m8-real-iam.md §1/§4/§5/§7/D2-D5/D9/D10/D12.
 *
 * Locks:
 *  - permissionsForOrganizationRole is the exact D3 4-way matrix, including
 *    the legacy "member" -> Viewer alias (spec §1 AC-1)
 *  - addAdminUserToOrganization defaults to "viewer" (D9), accepts the
 *    widened role set, and writes the D12 reverse-index row atomically
 *  - createAdminOrganizationWithOwner seeds the owner's reverse-index row
 *    (every org's Owner count starts at 1)
 *  - acceptAdminInvitation: happy path (existing + brand-new user), the
 *    email-mismatch IDOR case (§4 AC-2), expiry (§4 AC-3), idempotent
 *    re-accept (§4 AC-4), missing-profile new-user case
 *  - changeAdminMemberRole / removeAdminMember: D10 hierarchy guardrail,
 *    the last-Owner guardrail (self AND other-caller shapes), and D12
 *    reverse-index sync on every mutation
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const {
  permissionsForOrganizationRole,
  addAdminUserToOrganization,
  createAdminOrganizationWithOwner,
  acceptAdminInvitation,
  changeAdminMemberRole,
  removeAdminMember,
} = await import("@/lib/db/adminUserOrganization");
const { createOrUpdateAdminInvitation } =
  await import("@/lib/db/adminInvitation");
const {
  organizationMemberId,
  getAdminOrganizationMember,
  countAdminOrganizationOwners,
} = await import("@/lib/db/adminOrganizationMember");
const { OWNER_PERMISSIONS, EDITOR_PERMISSIONS, MEMBER_PERMISSIONS } =
  await import("@/types/collection");

const ORG_A = "org-a";
const ORG_B = "org-b";

function seedOrg(organizationId: string, memberCount = 1): void {
  fake.store.set(`Organization/${organizationId}`, {
    name: organizationId,
    slug: organizationId,
    type: "organization",
    status: "verified",
    domainVerified: true,
    inviteCodeEnabled: false,
    inviteLinkEnabled: false,
    allowDomainAutoJoin: false,
    ownerId: "owner@example.com",
    memberCount,
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
  });
}

interface SeedMemberOptions {
  name?: string;
  extraOrgs?: Array<{ organizationId: string; role: string }>;
}

// Seeds BOTH the authoritative User doc (organizations[] roster) and the
// D12 reverse-index row consistently — most fixtures in this file need
// both in sync to exercise the hierarchy/last-Owner guardrails correctly.
function seedMember(
  email: string,
  organizationId: string,
  role: string,
  options: SeedMemberOptions = {},
): void {
  const lower = email.toLowerCase();
  const name = options.name ?? lower;
  const organizations = [
    {
      organizationId,
      role,
      joinedAt: { seconds: 1 },
      joinMethod: "invite_link",
    },
    ...(options.extraOrgs ?? []).map((o) => ({
      ...o,
      joinedAt: { seconds: 1 },
      joinMethod: "invite_link",
    })),
  ];
  fake.store.set(`User/${lower}`, {
    uid: `uid-${lower}`,
    name,
    email: lower,
    organizationId,
    organizationRole: role,
    organizations,
    emailVerified: true,
    status: "active",
    permissions: permissionsForOrganizationRole(role as never),
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
  });
  fake.store.set(
    `OrganizationMember/${organizationMemberId(organizationId, lower)}`,
    { organizationId, email: lower, role, name, status: "active" },
  );
}

function commitConcurrentOwnerRemoval(email: string): void {
  const lower = email.toLowerCase();
  const memberPath = `OrganizationMember/${organizationMemberId(ORG_A, lower)}`;
  const userPath = `User/${lower}`;
  const user = fake.store.get(userPath) as {
    organizations: Array<{ organizationId: string }>;
  };
  const orgPath = `Organization/${ORG_A}`;
  const org = fake.store.get(orgPath) as { memberCount: number };

  fake.store.set(userPath, {
    ...user,
    organizations: user.organizations.filter(
      (membership) => membership.organizationId !== ORG_A,
    ),
  });
  fake.store.delete(memberPath);
  fake.store.set(orgPath, { ...org, memberCount: org.memberCount - 1 });
}

beforeEach(() => {
  fake.reset();
});

describe("permissionsForOrganizationRole — D3 matrix (spec §1 AC-1)", () => {
  it.each([
    ["owner", OWNER_PERMISSIONS],
    ["admin", OWNER_PERMISSIONS],
    ["editor", EDITOR_PERMISSIONS],
    ["viewer", MEMBER_PERMISSIONS],
    // Legacy alias (D2) — permanent, zero-cost.
    ["member", MEMBER_PERMISSIONS],
  ] as const)(
    "role %s returns the exact D3 permission set",
    (role, expected) => {
      expect(permissionsForOrganizationRole(role)).toEqual(expected);
    },
  );
});

describe("addAdminUserToOrganization — D9 default + widened role + D12 sync", () => {
  it("defaults to 'viewer' when no role is supplied (D9)", async () => {
    seedOrg(ORG_A, 1);

    const result = await addAdminUserToOrganization({
      userEmail: "newbie@example.com",
      organizationId: ORG_A,
      joinMethod: "invite_link",
      profile: { uid: "uid-newbie" },
    });

    expect(result.ok).toBe(true);
    const user = fake.store.get("User/newbie@example.com") as {
      organizationRole: string;
      permissions: string[];
    };
    expect(user.organizationRole).toBe("viewer");
    expect(user.permissions).toEqual(MEMBER_PERMISSIONS);
  });

  it("accepts the widened role set (e.g. 'editor') for an existing user", async () => {
    seedOrg(ORG_A, 1);
    seedMember("editor-to-be@example.com", ORG_B, "viewer");

    const result = await addAdminUserToOrganization({
      userEmail: "editor-to-be@example.com",
      organizationId: ORG_A,
      joinMethod: "invite_link",
      role: "editor",
    });
    expect(result.ok).toBe(true);

    const row = await getAdminOrganizationMember(
      ORG_A,
      "editor-to-be@example.com",
    );
    expect(row?.role).toBe("editor");
  });

  it("writes the D12 reverse-index row in the SAME logical operation as the roster join", async () => {
    seedOrg(ORG_A, 1);

    await addAdminUserToOrganization({
      userEmail: "synced@example.com",
      organizationId: ORG_A,
      joinMethod: "invite_code",
      role: "admin",
      profile: { uid: "uid-synced", name: "Synced Person" },
    });

    const row = await getAdminOrganizationMember(ORG_A, "synced@example.com");
    expect(row).toEqual({
      id: `${ORG_A}_synced@example.com`,
      organizationId: ORG_A,
      email: "synced@example.com",
      role: "admin",
      name: "Synced Person",
      status: "active",
    });
  });

  it("is idempotent on re-join — memberCount does not move twice", async () => {
    seedOrg(ORG_A, 1);

    await addAdminUserToOrganization({
      userEmail: "repeat@example.com",
      organizationId: ORG_A,
      joinMethod: "invite_link",
      profile: { uid: "uid-repeat" },
    });
    const afterFirst = fake.store.get(`Organization/${ORG_A}`) as {
      memberCount: number;
    };

    const second = await addAdminUserToOrganization({
      userEmail: "repeat@example.com",
      organizationId: ORG_A,
      joinMethod: "invite_link",
    });
    expect(second.ok && second.status).toBe("already-member");

    const afterSecond = fake.store.get(`Organization/${ORG_A}`) as {
      memberCount: number;
    };
    expect(afterSecond.memberCount).toBe(afterFirst.memberCount);
  });
});

describe("createAdminOrganizationWithOwner — D12 owner row", () => {
  it("seeds the brand-new owner's reverse-index row so the Owner count starts at 1", async () => {
    const result = await createAdminOrganizationWithOwner({
      ownerEmail: "founder@example.com",
      orgName: "Acme",
      emailDomain: null,
      isPersonalEmail: true,
      profile: { uid: "uid-founder", name: "Founder" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await getAdminOrganizationMember(
      result.organizationId,
      "founder@example.com",
    );
    expect(row?.role).toBe("owner");
    expect(await countAdminOrganizationOwners(result.organizationId)).toBe(1);
  });
});

describe("acceptAdminInvitation", () => {
  it("happy path: brand-new invitee accepts, lands at the INVITED role (not a default)", async () => {
    seedOrg(ORG_A, 1);
    seedMember("owner@example.com", ORG_A, "owner");

    const invite = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "brand-new@example.com",
      role: "editor",
    });
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;

    const result = await acceptAdminInvitation({
      token: invite.invitation.token,
      callerEmail: "brand-new@example.com",
      profile: { uid: "uid-brand-new", name: "Brand New" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.role).toBe("editor");
    expect(result.organizationId).toBe(ORG_A);

    const user = fake.store.get("User/brand-new@example.com") as {
      organizationRole: string;
      permissions: string[];
    };
    expect(user.organizationRole).toBe("editor");
    expect(user.permissions).toEqual(EDITOR_PERMISSIONS);

    const row = await getAdminOrganizationMember(
      ORG_A,
      "brand-new@example.com",
    );
    expect(row?.role).toBe("editor");

    const invDoc = fake.store.get(`Invitation/${invite.invitation.id}`) as {
      status: string;
      acceptedBy: string;
    };
    expect(invDoc.status).toBe("accepted");
    expect(invDoc.acceptedBy).toBe("brand-new@example.com");
  });

  it("happy path: an EXISTING user (member of a different org) accepts and gains a second membership", async () => {
    seedOrg(ORG_A, 1);
    seedOrg(ORG_B, 1);
    seedMember("owner@example.com", ORG_A, "owner");
    seedMember("multi-org@example.com", ORG_B, "viewer");

    const invite = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "multi-org@example.com",
      role: "viewer",
    });
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;

    const result = await acceptAdminInvitation({
      token: invite.invitation.token,
      callerEmail: "multi-org@example.com",
    });
    expect(result.ok).toBe(true);

    const user = fake.store.get("User/multi-org@example.com") as {
      organizations: Array<{ organizationId: string }>;
    };
    expect(user.organizations.map((o) => o.organizationId).sort()).toEqual(
      [ORG_A, ORG_B].sort(),
    );
  });

  it("rejects a MISMATCHED authenticated email — 403-shaped IDOR case (spec §4 AC-2)", async () => {
    seedOrg(ORG_A, 1);
    seedMember("owner@example.com", ORG_A, "owner");

    const invite = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "alice@example.com",
      role: "editor",
    });
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;

    const result = await acceptAdminInvitation({
      token: invite.invitation.token,
      callerEmail: "bob@example.com",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("EMAIL_MISMATCH");

    // Zero membership write, zero invitation-status change.
    expect(fake.store.has("User/bob@example.com")).toBe(false);
    const invDoc = fake.store.get(`Invitation/${invite.invitation.id}`) as {
      status: string;
    };
    expect(invDoc.status).toBe("pending");
  });

  it("rejects an expired invitation without needing a background sweep (spec §4 AC-3)", async () => {
    seedOrg(ORG_A, 1);
    seedMember("owner@example.com", ORG_A, "owner");

    const invite = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "late@example.com",
      role: "viewer",
    });
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;

    // Time-shift expiresAt into the past directly in the store.
    const stored = fake.store.get(
      `Invitation/${invite.invitation.id}`,
    ) as Record<string, unknown>;
    fake.store.set(`Invitation/${invite.invitation.id}`, {
      ...stored,
      expiresAt: { toMillis: () => Date.now() - 1_000 },
    });

    const result = await acceptAdminInvitation({
      token: invite.invitation.token,
      callerEmail: "late@example.com",
      profile: { uid: "uid-late" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID");
  });

  it("rejects re-accepting an already-accepted invitation — idempotent, no double join (spec §4 AC-4)", async () => {
    seedOrg(ORG_A, 1);
    seedMember("owner@example.com", ORG_A, "owner");

    const invite = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "twice@example.com",
      role: "viewer",
    });
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;

    const first = await acceptAdminInvitation({
      token: invite.invitation.token,
      callerEmail: "twice@example.com",
      profile: { uid: "uid-twice" },
    });
    expect(first.ok).toBe(true);
    const memberCountAfterFirst = (
      fake.store.get(`Organization/${ORG_A}`) as { memberCount: number }
    ).memberCount;

    const second = await acceptAdminInvitation({
      token: invite.invitation.token,
      callerEmail: "twice@example.com",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("INVALID");

    const memberCountAfterSecond = (
      fake.store.get(`Organization/${ORG_A}`) as { memberCount: number }
    ).memberCount;
    expect(memberCountAfterSecond).toBe(memberCountAfterFirst);
  });

  it("returns USER_PROFILE_REQUIRED for a brand-new invitee accepted without a profile", async () => {
    seedOrg(ORG_A, 1);
    seedMember("owner@example.com", ORG_A, "owner");

    const invite = await createOrUpdateAdminInvitation({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      email: "no-profile@example.com",
      role: "viewer",
    });
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;

    const result = await acceptAdminInvitation({
      token: invite.invitation.token,
      callerEmail: "no-profile@example.com",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("USER_PROFILE_REQUIRED");
  });

  it("returns INVALID for an unknown token", async () => {
    const result = await acceptAdminInvitation({
      token: "not-a-real-token",
      callerEmail: "whoever@example.com",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID");
  });
});

describe("changeAdminMemberRole — D10 hierarchy + last-Owner guardrails", () => {
  it("an Owner can promote an Editor to Admin", async () => {
    seedOrg(ORG_A, 2);
    seedMember("owner@example.com", ORG_A, "owner");
    seedMember("editor@example.com", ORG_A, "editor");

    const result = await changeAdminMemberRole({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      targetEmail: "editor@example.com",
      newRole: "admin",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.role).toBe("admin");

    const user = fake.store.get("User/editor@example.com") as {
      organizationRole: string;
      permissions: string[];
    };
    expect(user.organizationRole).toBe("admin");
    expect(user.permissions).toEqual(OWNER_PERMISSIONS);

    const row = await getAdminOrganizationMember(ORG_A, "editor@example.com");
    expect(row?.role).toBe("admin");
  });

  it("an Owner can demote an Admin to Editor", async () => {
    seedOrg(ORG_A, 2);
    seedMember("owner@example.com", ORG_A, "owner");
    seedMember("admin@example.com", ORG_A, "admin");

    const result = await changeAdminMemberRole({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      targetEmail: "admin@example.com",
      newRole: "editor",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.role).toBe("editor");
  });

  it("D10: an Admin caller cannot change an Owner's row", async () => {
    seedOrg(ORG_A, 2);
    seedMember("owner@example.com", ORG_A, "owner");
    seedMember("admin@example.com", ORG_A, "admin");

    const result = await changeAdminMemberRole({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      targetEmail: "owner@example.com",
      newRole: "editor",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("HIERARCHY_VIOLATION");
  });

  it("D10: an Admin caller cannot change another Admin's row", async () => {
    seedOrg(ORG_A, 2);
    seedMember("admin1@example.com", ORG_A, "admin");
    seedMember("admin2@example.com", ORG_A, "admin");

    const result = await changeAdminMemberRole({
      organizationId: ORG_A,
      callerEmail: "admin1@example.com",
      targetEmail: "admin2@example.com",
      newRole: "editor",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("HIERARCHY_VIOLATION");
  });

  it("D10: an Admin caller CAN change an Editor row to Viewer", async () => {
    seedOrg(ORG_A, 2);
    seedMember("admin@example.com", ORG_A, "admin");
    seedMember("editor@example.com", ORG_A, "editor");

    const result = await changeAdminMemberRole({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      targetEmail: "editor@example.com",
      newRole: "viewer",
    });
    expect(result.ok).toBe(true);
  });

  it("D10: an Admin caller cannot set ANYONE's role to Owner or Admin", async () => {
    seedOrg(ORG_A, 2);
    seedMember("admin@example.com", ORG_A, "admin");
    seedMember("viewer@example.com", ORG_A, "viewer");

    const toOwner = await changeAdminMemberRole({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      targetEmail: "viewer@example.com",
      newRole: "owner",
    });
    expect(toOwner.ok).toBe(false);
    if (toOwner.ok) return;
    expect(toOwner.code).toBe("HIERARCHY_VIOLATION");

    const toAdmin = await changeAdminMemberRole({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      targetEmail: "viewer@example.com",
      newRole: "admin",
    });
    expect(toAdmin.ok).toBe(false);
    if (toAdmin.ok) return;
    expect(toAdmin.code).toBe("HIERARCHY_VIOLATION");
  });

  it("rejects a non-manager caller (Editor/Viewer cannot change roles)", async () => {
    seedOrg(ORG_A, 2);
    seedMember("viewer@example.com", ORG_A, "viewer");
    seedMember("editor@example.com", ORG_A, "editor");

    const result = await changeAdminMemberRole({
      organizationId: ORG_A,
      callerEmail: "viewer@example.com",
      targetEmail: "editor@example.com",
      newRole: "viewer",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CALLER_NOT_AUTHORIZED");
  });

  it("returns TARGET_NOT_FOUND for a target outside this org", async () => {
    seedOrg(ORG_A, 1);
    seedOrg(ORG_B, 1);
    seedMember("owner@example.com", ORG_A, "owner");
    seedMember("stranger@example.com", ORG_B, "viewer");

    const result = await changeAdminMemberRole({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      targetEmail: "stranger@example.com",
      newRole: "editor",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("TARGET_NOT_FOUND");
  });

  it("last-Owner guardrail: a sole Owner cannot demote themselves — zero write", async () => {
    seedOrg(ORG_A, 1);
    seedMember("solo@example.com", ORG_A, "owner");

    const result = await changeAdminMemberRole({
      organizationId: ORG_A,
      callerEmail: "solo@example.com",
      targetEmail: "solo@example.com",
      newRole: "admin",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LAST_OWNER");

    const row = await getAdminOrganizationMember(ORG_A, "solo@example.com");
    expect(row?.role).toBe("owner");
  });

  it("last-Owner guardrail: with 2 Owners, one CAN demote the other (other-caller shape); the survivor then cannot demote themselves", async () => {
    seedOrg(ORG_A, 2);
    seedMember("owner1@example.com", ORG_A, "owner");
    seedMember("owner2@example.com", ORG_A, "owner");

    const demoteOther = await changeAdminMemberRole({
      organizationId: ORG_A,
      callerEmail: "owner1@example.com",
      targetEmail: "owner2@example.com",
      newRole: "admin",
    });
    expect(demoteOther.ok).toBe(true);
    expect(await countAdminOrganizationOwners(ORG_A)).toBe(1);

    const demoteSelf = await changeAdminMemberRole({
      organizationId: ORG_A,
      callerEmail: "owner1@example.com",
      targetEmail: "owner1@example.com",
      newRole: "admin",
    });
    expect(demoteSelf.ok).toBe(false);
    if (demoteSelf.ok) return;
    expect(demoteSelf.code).toBe("LAST_OWNER");
  });
});

describe("removeAdminMember — D10 hierarchy + last-Owner guardrails + D12 sync", () => {
  it("M8-T8: retries a 2-Owner removal after a concurrent removal and returns LAST_OWNER", async () => {
    seedOrg(ORG_A, 2);
    seedMember("owner1@example.com", ORG_A, "owner");
    seedMember("owner2@example.com", ORG_A, "owner");

    let interleavedOwnerCount: number | null = null;
    let concurrentRemovalSucceeded = false;
    fake.setTransactionInterleave(async () => {
      commitConcurrentOwnerRemoval("owner2@example.com");
      concurrentRemovalSucceeded = true;
      interleavedOwnerCount = await countAdminOrganizationOwners(ORG_A);
    });

    const secondRemoval = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "owner1@example.com",
      targetEmail: "owner1@example.com",
    });

    expect(interleavedOwnerCount).toBe(1);
    expect(secondRemoval).toEqual({ ok: false, code: "LAST_OWNER" });
    expect(await countAdminOrganizationOwners(ORG_A)).toBe(1);
    expect(
      await getAdminOrganizationMember(ORG_A, "owner1@example.com"),
    ).not.toBeNull();
    expect(
      await getAdminOrganizationMember(ORG_A, "owner2@example.com"),
    ).toBeNull();
    expect([concurrentRemovalSucceeded, secondRemoval.ok].filter(Boolean)).toHaveLength(
      1,
    );
  });

  it("M8-T8 mutation proof: an inside-callback non-transactional owner count misses the demotion race", async () => {
    const seedTwoOwners = () => {
      seedOrg(ORG_A, 2);
      seedMember("owner1@example.com", ORG_A, "owner");
      seedMember("owner2@example.com", ORG_A, "owner");
    };
    const commitConcurrentOwnerDemotion = () => {
      const email = "owner2@example.com";
      const userPath = `User/${email}`;
      const memberPath = `OrganizationMember/${organizationMemberId(ORG_A, email)}`;
      const user = fake.store.get(userPath) as {
        organizations: Array<{ organizationId: string; role: string }>;
      };
      const member = fake.store.get(memberPath) as Record<string, unknown>;

      fake.store.set(userPath, {
        ...user,
        organizations: user.organizations.map((membership) =>
          membership.organizationId === ORG_A
            ? { ...membership, role: "editor" }
            : membership,
        ),
      });
      fake.store.set(memberPath, { ...member, role: "editor" });
    };

    seedTwoOwners();

    // Regression-catcher: this is the exact helper-swap mutant. The real
    // non-transactional counter remains inside the callback at the guard's
    // location, but its owner-query reads never enter this transaction's
    // read-set. The buggy path tx.gets owner1 and the org, not owner2's User
    // or OrganizationMember row, so owner2's concurrent demotion cannot
    // conflict and the stale count commits on the first attempt.
    let buggyAttempts = 0;
    fake.setTransactionInterleave(commitConcurrentOwnerDemotion);
    const buggyRemoval = await fake.db.runTransaction(async (tx) => {
      buggyAttempts += 1;
      const userRef = fake.db.collection("User").doc("owner1@example.com");
      const orgRef = fake.db.collection("Organization").doc(ORG_A);
      const memberRef = fake.db
        .collection("OrganizationMember")
        .doc(organizationMemberId(ORG_A, "owner1@example.com"));
      const userSnap = await tx.get(userRef);
      const orgSnap = await tx.get(orgRef);
      if ("docs" in userSnap || "docs" in orgSnap) {
        throw new Error("expected document snapshots");
      }
      const user = userSnap.data() as {
        organizations: Array<{ organizationId: string }>;
      };
      const org = orgSnap.data() as { memberCount: number };

      const ownerCount = await countAdminOrganizationOwners(ORG_A);
      if (ownerCount <= 1) return { ok: false as const, code: "LAST_OWNER" };

      tx.update(userRef, {
        organizations: user.organizations.filter(
          (membership) => membership.organizationId !== ORG_A,
        ),
      });
      tx.update(orgRef, { memberCount: org.memberCount - 1 });
      tx.delete(memberRef);
      return { ok: true as const };
    });

    expect(buggyAttempts).toBe(1);
    expect(buggyRemoval).toEqual({ ok: true });
    expect(await countAdminOrganizationOwners(ORG_A)).toBe(0);

    // Same interleave, real guard: tx.get(ownerQuery) tracks owner2's member
    // row, so its demotion conflicts, the callback retries, and LAST_OWNER
    // preserves owner1 as the sole Owner.
    fake.reset();
    seedTwoOwners();
    fake.setTransactionInterleave(commitConcurrentOwnerDemotion);
    const realRemoval = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "owner1@example.com",
      targetEmail: "owner1@example.com",
    });

    expect(realRemoval).toEqual({ ok: false, code: "LAST_OWNER" });
    expect(await countAdminOrganizationOwners(ORG_A)).toBe(1);
    expect(
      await getAdminOrganizationMember(ORG_A, "owner1@example.com"),
    ).not.toBeNull();
  });

  it("an Owner can remove an Editor — reverse-index deleted, memberCount decremented", async () => {
    seedOrg(ORG_A, 2);
    seedMember("owner@example.com", ORG_A, "owner");
    seedMember("editor@example.com", ORG_A, "editor");

    const result = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      targetEmail: "editor@example.com",
    });
    expect(result.ok).toBe(true);

    expect(
      await getAdminOrganizationMember(ORG_A, "editor@example.com"),
    ).toBeNull();
    const org = fake.store.get(`Organization/${ORG_A}`) as {
      memberCount: number;
    };
    expect(org.memberCount).toBe(1);
  });

  it("uses predicate filtering — removing one org membership preserves the user's OTHER org memberships", async () => {
    seedOrg(ORG_A, 2);
    seedOrg(ORG_B, 1);
    seedMember("owner@example.com", ORG_A, "owner");
    seedMember("multi@example.com", ORG_A, "viewer", {
      extraOrgs: [{ organizationId: ORG_B, role: "owner" }],
    });

    const result = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      targetEmail: "multi@example.com",
    });
    expect(result.ok).toBe(true);

    const user = fake.store.get("User/multi@example.com") as {
      organizations: Array<{ organizationId: string }>;
    };
    expect(user.organizations.map((o) => o.organizationId)).toEqual([ORG_B]);
  });

  it("D10: an Admin caller cannot remove an Owner or Admin row", async () => {
    seedOrg(ORG_A, 3);
    seedMember("admin@example.com", ORG_A, "admin");
    seedMember("owner@example.com", ORG_A, "owner");
    seedMember("admin2@example.com", ORG_A, "admin");

    const removeOwner = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      targetEmail: "owner@example.com",
    });
    expect(removeOwner.ok).toBe(false);
    if (removeOwner.ok) return;
    expect(removeOwner.code).toBe("HIERARCHY_VIOLATION");

    const removeAdmin = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      targetEmail: "admin2@example.com",
    });
    expect(removeAdmin.ok).toBe(false);
    if (removeAdmin.ok) return;
    expect(removeAdmin.code).toBe("HIERARCHY_VIOLATION");
  });

  it("D10: an Admin caller CAN remove an Editor or Viewer row", async () => {
    seedOrg(ORG_A, 3);
    seedMember("admin@example.com", ORG_A, "admin");
    seedMember("editor@example.com", ORG_A, "editor");
    seedMember("viewer@example.com", ORG_A, "viewer");

    const removeEditor = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      targetEmail: "editor@example.com",
    });
    expect(removeEditor.ok).toBe(true);

    const removeViewer = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "admin@example.com",
      targetEmail: "viewer@example.com",
    });
    expect(removeViewer.ok).toBe(true);
  });

  it("last-Owner guardrail: a sole Owner cannot remove themselves — zero write", async () => {
    seedOrg(ORG_A, 1);
    seedMember("solo@example.com", ORG_A, "owner");

    const result = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "solo@example.com",
      targetEmail: "solo@example.com",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LAST_OWNER");

    const org = fake.store.get(`Organization/${ORG_A}`) as {
      memberCount: number;
    };
    expect(org.memberCount).toBe(1);
    expect(
      await getAdminOrganizationMember(ORG_A, "solo@example.com"),
    ).not.toBeNull();
  });

  it("last-Owner guardrail: with 2 Owners, one CAN remove the other; the survivor then cannot remove themselves", async () => {
    seedOrg(ORG_A, 2);
    seedMember("owner1@example.com", ORG_A, "owner");
    seedMember("owner2@example.com", ORG_A, "owner");

    const removeOther = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "owner1@example.com",
      targetEmail: "owner2@example.com",
    });
    expect(removeOther.ok).toBe(true);
    expect(await countAdminOrganizationOwners(ORG_A)).toBe(1);

    const removeSelf = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "owner1@example.com",
      targetEmail: "owner1@example.com",
    });
    expect(removeSelf.ok).toBe(false);
    if (removeSelf.ok) return;
    expect(removeSelf.code).toBe("LAST_OWNER");
  });

  it("an Owner CAN remove/demote themselves when at least one other Owner remains (spec §5 AC-4)", async () => {
    seedOrg(ORG_A, 2);
    seedMember("owner1@example.com", ORG_A, "owner");
    seedMember("owner2@example.com", ORG_A, "owner");

    const result = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "owner1@example.com",
      targetEmail: "owner1@example.com",
    });
    expect(result.ok).toBe(true);
    expect(await countAdminOrganizationOwners(ORG_A)).toBe(1);
  });

  it("returns TARGET_NOT_FOUND for a target outside this org", async () => {
    seedOrg(ORG_A, 1);
    seedOrg(ORG_B, 1);
    seedMember("owner@example.com", ORG_A, "owner");
    seedMember("stranger@example.com", ORG_B, "viewer");

    const result = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "owner@example.com",
      targetEmail: "stranger@example.com",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("TARGET_NOT_FOUND");
  });

  it("rejects a non-manager caller (Editor/Viewer cannot remove members)", async () => {
    seedOrg(ORG_A, 2);
    seedMember("editor@example.com", ORG_A, "editor");
    seedMember("viewer@example.com", ORG_A, "viewer");

    const result = await removeAdminMember({
      organizationId: ORG_A,
      callerEmail: "editor@example.com",
      targetEmail: "viewer@example.com",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CALLER_NOT_AUTHORIZED");
  });
});
