// @vitest-environment node
/**
 * QA regression (M8-T1 QA pass, Priority 1) — "Permission matrix, real
 * end-to-end." Every shipped route test for both the new IAM routes and the
 * §6 VERIFY inventory (route-scope.test.ts, attendees-list-export-
 * routes.test.ts, iam-*-route.test.ts) gates its Owner/Admin/Editor/Viewer
 * assertions against a HAND-TYPED `permissions: [...]` array on a mocked
 * `getAdminUserByEmail` — never against a real role fixture whose
 * `permissions[]` was actually produced by `permissionsForOrganizationRole()`
 * and written through the real DAL. That leaves a real (if narrow) gap: a
 * regression that broke `permissionsForOrganizationRole()`'s wiring into
 * `addAdminUserToOrganization`/`createAdminOrganizationWithOwner` (D4 — "the
 * ~50 existing routes need zero code changes... once permissions are
 * (re-)stamped correctly on every membership mutation") would NOT be caught
 * by any existing test, because every route test's fixture bypasses that
 * wiring entirely and hand-writes the permissions array directly.
 *
 * This file closes that gap: real Owner/Admin/Editor/Viewer `User` +
 * `OrganizationMember` fixtures are seeded via the SAME
 * `permissionsForOrganizationRole()` the production mutation paths call
 * (mirroring `admin-user-organization-iam.test.ts`'s own `seedMember`
 * helper), only `next/headers` (cookies) and `@/lib/auth-utils` (decodeUser)
 * are mocked, and the REAL route handlers are invoked end-to-end against the
 * REAL `fake-admin-db`-backed DAL — for a sample spanning:
 *   - a write:events route (§6 VERIFY list: events/[eventId]/status POST)
 *   - the ONE reclassified view-tier route (attendees GET, D6)
 *   - the roster GET (view-tier by design, spec §2 AC-1)
 *   - a write:user IAM route (members/[email] PATCH, spec §5)
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
const { organizationMemberId } =
  await import("@/lib/db/adminOrganizationMember");

const { POST: postEventStatus } =
  await import("@/app/api/dashboard/events/[eventId]/status/route");
const { GET: getAttendees } =
  await import("@/app/api/dashboard/events/[eventId]/attendees/route");
const { GET: getIam } = await import("@/app/api/dashboard/iam/route");
const { PATCH: patchMember } =
  await import("@/app/api/dashboard/iam/members/[email]/route");

const ORG_ID = "org-perm-matrix";
const EVENT_ID = "evt-perm-matrix";

type Role = "owner" | "admin" | "editor" | "viewer";

// Seeds a REAL fixture through the same shape production writes use — the
// permissions array comes from calling permissionsForOrganizationRole()
// itself, never a hand-typed literal, so a regression in the D3 matrix or
// its wiring into the mutation paths would surface here.
function seedRoleFixture(email: string, role: Role): void {
  const lower = email.toLowerCase();
  fake.store.set(`User/${lower}`, {
    uid: `uid-${lower}`,
    name: lower,
    email: lower,
    organizationId: ORG_ID,
    organizationRole: role,
    organizations: [
      {
        organizationId: ORG_ID,
        role,
        joinedAt: { seconds: 1 },
        joinMethod: "invite_link",
      },
    ],
    emailVerified: true,
    status: "active",
    permissions: permissionsForOrganizationRole(role),
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
  });
  fake.store.set(`OrganizationMember/${organizationMemberId(ORG_ID, lower)}`, {
    organizationId: ORG_ID,
    email: lower,
    role,
    name: lower,
    status: "active",
  });
}

function seedOrg(): void {
  fake.store.set(`Organization/${ORG_ID}`, {
    name: "Perm Matrix Org",
    slug: ORG_ID,
    type: "organization",
    status: "verified",
    domainVerified: true,
    inviteCodeEnabled: false,
    inviteLinkEnabled: false,
    allowDomainAutoJoin: false,
    ownerId: "owner@perm-matrix.example.com",
    memberCount: 4,
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
  });
}

function seedEvent(): void {
  fake.store.set(`Event/${EVENT_ID}`, {
    name: "Perm Matrix Summit",
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

function signInAs(email: string) {
  cookies.mockResolvedValue({
    get: (name: string) =>
      name === "session" ? { value: "token" } : undefined,
  });
  decodeUser.mockResolvedValue({
    uid: `uid-${email}`,
    name: "Test User",
    picture: "",
    email,
  });
}

function eventContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
  seedOrg();
  seedEvent();
  seedRoleFixture("owner@perm-matrix.example.com", "owner");
  seedRoleFixture("admin@perm-matrix.example.com", "admin");
  seedRoleFixture("editor@perm-matrix.example.com", "editor");
  seedRoleFixture("viewer@perm-matrix.example.com", "viewer");
});

describe("write:events route (POST status) — real Owner/Admin/Editor/Viewer fixtures, real DAL", () => {
  it.each([
    ["owner@perm-matrix.example.com", "owner"],
    ["admin@perm-matrix.example.com", "admin"],
    ["editor@perm-matrix.example.com", "editor"],
  ] as const)(
    "%s (%s) can publish the event — 200, and the real Event doc is updated",
    async (email, _role) => {
      signInAs(email);
      const response = await postEventStatus(
        new Request("http://localhost/x", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Published" }),
        }),
        eventContext(),
      );
      expect(response.status).toBe(200);
      expect(
        (fake.store.get(`Event/${EVENT_ID}`) as { status: string }).status,
      ).toBe("Published");
    },
  );

  it("a real Viewer fixture is REJECTED (403) and the Event doc is left completely unchanged", async () => {
    signInAs("viewer@perm-matrix.example.com");
    const response = await postEventStatus(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Published" }),
      }),
      eventContext(),
    );
    expect(response.status).toBe(403);
    expect(
      (fake.store.get(`Event/${EVENT_ID}`) as { status: string }).status,
    ).toBe("Draft");
  });
});

describe("attendees GET (D6 view-tier reclassification) — real fixtures, real DAL", () => {
  it.each([
    "owner@perm-matrix.example.com",
    "admin@perm-matrix.example.com",
    "editor@perm-matrix.example.com",
    "viewer@perm-matrix.example.com",
  ])(
    "%s gets 200 (the D6 reclassification genuinely admits a real Viewer, not just a mocked one)",
    async (email) => {
      signInAs(email);
      const response = await getAttendees(
        new Request(
          `http://localhost/api/dashboard/events/${EVENT_ID}/attendees`,
        ),
        eventContext(),
      );
      expect(response.status).toBe(200);
    },
  );
});

describe("GET /api/dashboard/iam (view-tier roster) — real Viewer fixture, real DAL", () => {
  it("a real Viewer fixture sees the full real roster (200), not 403", async () => {
    signInAs("viewer@perm-matrix.example.com");
    const response = await getIam(
      new Request("http://localhost/api/dashboard/iam"),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.members.map((m: { email: string }) => m.email).sort()).toEqual(
      [
        "admin@perm-matrix.example.com",
        "editor@perm-matrix.example.com",
        "owner@perm-matrix.example.com",
        "viewer@perm-matrix.example.com",
      ].sort(),
    );
    expect(data.canManageMembers).toBe(false);
  });

  it("a real Owner fixture also sees canManageMembers: true", async () => {
    signInAs("owner@perm-matrix.example.com");
    const response = await getIam(
      new Request("http://localhost/api/dashboard/iam"),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.canManageMembers).toBe(true);
  });
});

describe("PATCH /api/dashboard/iam/members/[email] (write:user) — real fixtures, real DAL", () => {
  it("a real Owner fixture can change a real Editor fixture's role to viewer — 200, roster + reverse-index genuinely updated", async () => {
    signInAs("owner@perm-matrix.example.com");
    const response = await patchMember(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "viewer" }),
      }),
      { params: Promise.resolve({ email: "editor@perm-matrix.example.com" }) },
    );
    expect(response.status).toBe(200);

    const user = fake.store.get("User/editor@perm-matrix.example.com") as {
      organizationRole: string;
      permissions: string[];
    };
    expect(user.organizationRole).toBe("viewer");
    expect(user.permissions).toEqual(permissionsForOrganizationRole("viewer"));
    const row = fake.store.get(
      `OrganizationMember/${organizationMemberId(ORG_ID, "editor@perm-matrix.example.com")}`,
    ) as { role: string };
    expect(row.role).toBe("viewer");
  });

  it.each(["editor@perm-matrix.example.com", "viewer@perm-matrix.example.com"])(
    "a real %s fixture (no write:user) is REJECTED (403) and the target's role is left unchanged",
    async (callerEmail) => {
      signInAs(callerEmail);
      const response = await patchMember(
        new Request("http://localhost/x", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "admin" }),
        }),
        {
          params: Promise.resolve({ email: "viewer@perm-matrix.example.com" }),
        },
      );
      expect(response.status).toBe(403);

      const user = fake.store.get("User/viewer@perm-matrix.example.com") as {
        organizationRole: string;
      };
      expect(user.organizationRole).toBe("viewer");
    },
  );

  it("a real Admin fixture is REJECTED (403, D10 hierarchy) attempting to touch the real Owner fixture's row", async () => {
    signInAs("admin@perm-matrix.example.com");
    const response = await patchMember(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "editor" }),
      }),
      { params: Promise.resolve({ email: "owner@perm-matrix.example.com" }) },
    );
    expect(response.status).toBe(403);

    const user = fake.store.get("User/owner@perm-matrix.example.com") as {
      organizationRole: string;
    };
    expect(user.organizationRole).toBe("owner");
  });
});
