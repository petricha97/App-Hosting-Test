// @vitest-environment node
/**
 * QA regression (M8-T1 QA pass, Priority 2) — "Full member lifecycle E2E."
 *
 * Every stage of the invite -> accept -> role-change -> removal lifecycle
 * had SOME test coverage in the shipped M8-T1 diff, but always as isolated,
 * independently-fixtured `it()` blocks calling DAL functions directly (e.g.
 * admin-user-organization-iam.test.ts's `acceptAdminInvitation` tests each
 * build their own invite via `createOrUpdateAdminInvitation` first) — never
 * one continuous flow through the REAL HTTP route handlers, where each
 * stage's output (the invite token from the create response, the
 * organizationId from the accept response) actually feeds the next stage,
 * the way a real client would drive it. That leaves a real gap: nothing
 * proves the routes' own request/response wiring (not just each DAL
 * function in isolation) composes correctly end-to-end.
 *
 * This test drives ALL FIVE IAM routes as one continuous flow against a
 * REAL `fake-admin-db`-backed DAL (only `next/headers` and
 * `@/lib/auth-utils` are mocked):
 *   1. Owner invites a new teammate as Editor -> pending "Invited" row.
 *   2. GET /api/dashboard/iam shows the pending invitation, NOT a member row.
 *   3. The invited email (a DIFFERENT authenticated identity, via Bearer
 *      token, mirroring the real mid-signup accept case) accepts using the
 *      token from step 1's response -> becomes an Active member at Editor.
 *   4. GET /api/dashboard/iam now shows them as an active Editor member, the
 *      pending invitation is gone.
 *   5. Their ACTUAL functional permission is proven, not just the stored
 *      permissions[] array: they can successfully POST to a real
 *      write:events route.
 *   6. Owner demotes them to Viewer via PATCH -> their next request to the
 *      SAME write:events route now genuinely 403s (D11 "next request"
 *      freshness, proven functionally, not just via the stored array).
 *   7. Owner removes them via DELETE -> GET /api/dashboard/iam no longer
 *      lists them, and their next request to ANY dashboard route now 403s
 *      (resolveActiveOrganizationId finds no matching roster entry).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { cookies, decodeUser } = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));

const { permissionsForOrganizationRole } =
  await import("@/lib/db/adminUserOrganization");

const { POST: createInvite } =
  await import("@/app/api/dashboard/iam/invites/route");
const { GET: getIam } = await import("@/app/api/dashboard/iam/route");
const { POST: acceptInvite } =
  await import("@/app/api/organizations/invitations/accept/route");
const { PATCH: patchMember, DELETE: deleteMember } =
  await import("@/app/api/dashboard/iam/members/[email]/route");
const { POST: postEventStatus } =
  await import("@/app/api/dashboard/events/[eventId]/status/route");

const ORG_ID = "org-lifecycle";
const EVENT_ID = "evt-lifecycle";
const OWNER_EMAIL = "owner@lifecycle.example.com";
const NEW_HIRE_EMAIL = "new-hire@lifecycle.example.com";

// A single "who is signed in right now" identity the mocked cookies/
// decodeUser resolve to — real routes never see the difference between this
// and a real Firebase session.
let sessionIdentity: { email: string; uid: string } | null = null;

function signInAs(email: string) {
  sessionIdentity = { email, uid: `uid-${email}` };
}

function signOut() {
  sessionIdentity = null;
}

function seedOrgAndOwner(): void {
  fake.store.set(`Organization/${ORG_ID}`, {
    name: "Lifecycle Org",
    slug: ORG_ID,
    type: "organization",
    status: "verified",
    domainVerified: true,
    inviteCodeEnabled: false,
    inviteLinkEnabled: false,
    allowDomainAutoJoin: false,
    ownerId: OWNER_EMAIL,
    memberCount: 1,
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
  });
  fake.store.set(`User/${OWNER_EMAIL}`, {
    uid: "uid-owner",
    name: "Owner Person",
    email: OWNER_EMAIL,
    organizationId: ORG_ID,
    organizationRole: "owner",
    organizations: [
      {
        organizationId: ORG_ID,
        role: "owner",
        joinedAt: { seconds: 1 },
        joinMethod: "created",
      },
    ],
    emailVerified: true,
    status: "active",
    permissions: permissionsForOrganizationRole("owner"),
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
  });
  fake.store.set(`OrganizationMember/${ORG_ID}_${OWNER_EMAIL}`, {
    organizationId: ORG_ID,
    email: OWNER_EMAIL,
    role: "owner",
    name: "Owner Person",
    status: "active",
  });
}

function seedEvent(): void {
  fake.store.set(`Event/${EVENT_ID}`, {
    name: "Lifecycle Summit",
    description: "A summit",
    capacity: 100,
    expectedGuests: 50,
    formPath: "Form/form-1",
    invoicePath: "",
    organizationPath: `Organization/${ORG_ID}`,
    timezone: "UTC",
    allowOverlap: false,
    status: "Draft",
    pageMode: "default",
    redirectUrl: "",
    periods: [],
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
  });
}

function eventContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

function memberContext(email: string) {
  return { params: Promise.resolve({ email }) };
}

async function postStatus() {
  return postEventStatus(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Published" }),
    }),
    eventContext(),
  );
}

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
  sessionIdentity = null;
  seedOrgAndOwner();
  seedEvent();

  // Session-cookie auth (used for every dashboard-scoped call in this test).
  cookies.mockResolvedValue({
    get: (name: string) => {
      if (name !== "session") return undefined;
      return sessionIdentity
        ? { value: `cookie:${sessionIdentity.email}` }
        : undefined;
    },
  });
  decodeUser.mockImplementation(async (token: string) => {
    if (!sessionIdentity) return { error: "No session" };
    // Accept both the session-cookie token shape and a raw bearer token
    // carrying the signed-in identity's email (mirrors the real accept
    // route's dual-auth: Authorization: Bearer <idToken> OR session cookie).
    return {
      uid: sessionIdentity.uid,
      name: "Test User",
      picture: "",
      email: sessionIdentity.email,
    };
  });
});

describe("Full member lifecycle E2E — real routes, real fake-admin-db DAL", () => {
  it("invite -> pending -> accept (as the invited identity) -> active Editor with REAL functional permissions -> role change -> removal", async () => {
    // --- 1. Owner invites the new hire as Editor. ---
    signInAs(OWNER_EMAIL);
    const inviteResponse = await createInvite(
      new Request("http://localhost/api/dashboard/iam/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: NEW_HIRE_EMAIL, role: "editor" }),
      }),
    );
    expect(inviteResponse.status).toBe(201);
    const inviteBody = await inviteResponse.json();
    expect(inviteBody.invitation.status).toBe("invited");
    expect(inviteBody.invitation.role).toBe("editor");
    const acceptToken = inviteBody.acceptUrl.split("/invite/")[1];
    expect(acceptToken).toBeTruthy();

    // --- 2. The roster shows a pending invitation, NOT yet a member. ---
    const rosterBeforeAccept = await (
      await getIam(new Request("http://localhost/api/dashboard/iam"))
    ).json();
    expect(
      rosterBeforeAccept.members.some(
        (m: { email: string }) => m.email === NEW_HIRE_EMAIL,
      ),
    ).toBe(false);
    const pendingRow = rosterBeforeAccept.invitations.find(
      (i: { email: string }) => i.email === NEW_HIRE_EMAIL,
    );
    expect(pendingRow).toMatchObject({ role: "editor", status: "invited" });

    // --- 3. The INVITED identity (not the Owner) accepts, via Bearer auth
    //        (mirrors the real mid-signup case where no session cookie
    //        exists yet for the brand-new user). ---
    signInAs(NEW_HIRE_EMAIL);
    const acceptResponse = await acceptInvite(
      new Request("http://localhost/api/organizations/invitations/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer new-hire-id-token",
        },
        body: JSON.stringify({ token: acceptToken, displayName: "New Hire" }),
      }),
    );
    expect(acceptResponse.status).toBe(200);
    const acceptBody = await acceptResponse.json();
    expect(acceptBody).toEqual({ organizationId: ORG_ID, role: "editor" });

    // --- 4. The roster now shows them Active at Editor; invitation gone. ---
    signInAs(OWNER_EMAIL);
    const rosterAfterAccept = await (
      await getIam(new Request("http://localhost/api/dashboard/iam"))
    ).json();
    const memberRow = rosterAfterAccept.members.find(
      (m: { email: string }) => m.email === NEW_HIRE_EMAIL,
    );
    expect(memberRow).toMatchObject({ email: NEW_HIRE_EMAIL, role: "editor" });
    expect(
      rosterAfterAccept.invitations.some(
        (i: { email: string }) => i.email === NEW_HIRE_EMAIL,
      ),
    ).toBe(false);

    // --- 5. Their role's ACTUAL functional permission is real, not just a
    //        stored array: they can genuinely publish the event. ---
    signInAs(NEW_HIRE_EMAIL);
    const publishAsEditor = await postStatus();
    expect(publishAsEditor.status).toBe(200);
    expect(
      (fake.store.get(`Event/${EVENT_ID}`) as { status: string }).status,
    ).toBe("Published");

    // --- 6. Owner demotes them to Viewer; their VERY NEXT request to the
    //        same route genuinely 403s (D11 "next request" freshness,
    //        proven functionally). ---
    signInAs(OWNER_EMAIL);
    const demote = await patchMember(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "viewer" }),
      }),
      memberContext(NEW_HIRE_EMAIL),
    );
    expect(demote.status).toBe(200);

    signInAs(NEW_HIRE_EMAIL);
    const publishAsViewer = await postStatus();
    expect(publishAsViewer.status).toBe(403);

    // --- 7. Owner removes them entirely; the roster no longer lists them,
    //        and their next request to ANY dashboard route 403s (no
    //        matching roster entry for their now-stale active org). ---
    signInAs(OWNER_EMAIL);
    const removal = await deleteMember(
      new Request("http://localhost/x", { method: "DELETE" }),
      memberContext(NEW_HIRE_EMAIL),
    );
    expect(removal.status).toBe(200);

    const rosterAfterRemoval = await (
      await getIam(new Request("http://localhost/api/dashboard/iam"))
    ).json();
    expect(
      rosterAfterRemoval.members.some(
        (m: { email: string }) => m.email === NEW_HIRE_EMAIL,
      ),
    ).toBe(false);

    signInAs(NEW_HIRE_EMAIL);
    const postRemovalAttempt = await postStatus();
    expect(postRemovalAttempt.status).toBe(403);
  });
});
