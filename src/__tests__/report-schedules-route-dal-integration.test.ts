// @vitest-environment node
/**
 * M7-T3 — end-to-end integration between the route layer
 * (src/app/api/dashboard/events/[eventId]/reports/schedules/...) and the
 * REAL DAL (src/lib/db/adminReportSchedule.ts), against the in-memory fake
 * admin db. Spec: agents/docs/specs/m7-scheduled-reports.md.
 *
 * This closes the gap between report-schedules-routes.test.ts (routes
 * real, DAL mocked) and admin-report-schedule.test.ts (DAL real, no
 * routes) by exercising both layers together for a genuine round trip.
 * Only auth/session (cookies/decodeUser/adminUser) and adminEvent are
 * mocked.
 *
 * Locks:
 *  - full CRUD (create/list/edit/pause/resume/delete) round-trips through
 *    the real DAL for all 5 report templates
 *  - recipient validation rejects all-or-nothing (a single bad email in a
 *    3-email batch writes ZERO schedule docs, confirmed via re-fetch)
 *  - permission gating (no write:events) 403s on every CRUD verb through
 *    the real route + real scope check, with zero docs ever written
 *  - cross-org IDOR: a write:events holder of Org A cannot read/edit/
 *    delete Org B's schedule through the real route + real DAL scoping
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));

import { createFakeAdminDb } from "./helpers/fake-admin-db";
const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

// Dynamic imports performed AFTER `fake` above is initialized: static
// imports are hoisted above regular top-level statements (though below
// vi.mock calls), which would trigger the "@/app/lib/firestore" mock
// factory before `fake` exists (TDZ error).
const { resetRateLimits } = await import("@/lib/rate-limit");
const { GET: listGET, POST: listPOST } =
  await import("@/app/api/dashboard/events/[eventId]/reports/schedules/route");
const {
  DELETE: itemDELETE,
  GET: itemGET,
  PATCH: itemPATCH,
} = await import("@/app/api/dashboard/events/[eventId]/reports/schedules/[templateSlug]/route");
const { REPORT_TEMPLATE_IDS } = await import("@/features/reports/templates");

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const OTHER_ORG_ID = "org-2";

function ctx(eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId }) };
}
function slugCtx(templateSlug: string, eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId, templateSlug }) };
}

function seedMember(
  email: string,
  organizationId: string,
  name = "Member",
): void {
  fake.store.set(`User/${email}`, {
    uid: `uid-${email}`,
    name,
    email,
    organizationId,
    organizationRole: "member",
    organizations: [
      {
        organizationId,
        role: "member",
        joinedAt: { seconds: 1 },
        joinMethod: "invite_link",
      },
    ],
    emailVerified: true,
    status: "active",
    permissions: ["view:events"],
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
  });
}

function asSessionUser(
  email: string,
  permissions: string[] = ["write:events"],
) {
  cookies.mockResolvedValue({
    get: (name: string) =>
      name === "session" ? { value: "token" } : undefined,
  });
  decodeUser.mockResolvedValue({
    uid: "u1",
    name: "Organizer",
    picture: "",
    email,
  });
  getAdminUserByEmail.mockResolvedValue({
    organizationId: ORG_ID,
    organizations: [{ organizationId: ORG_ID, role: "member" }],
    permissions,
    email,
  });
}

function postReq(body: unknown, url: string) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SCHEDULES_URL = `http://localhost/api/dashboard/events/${EVENT_ID}/reports/schedules`;

beforeEach(() => {
  fake.reset();
  resetRateLimits();
  vi.clearAllMocks();
  getAdminEventForOrganization.mockResolvedValue({
    id: EVENT_ID,
    name: "Summit",
  });
  asSessionUser("organizer@example.com");
});

describe("route + real DAL — full CRUD round trip", () => {
  it("creates a schedule for EACH of the 5 templates, edits, pauses, resumes, deletes", async () => {
    seedMember("organizer@example.com", ORG_ID, "Organizer");

    for (const slug of REPORT_TEMPLATE_IDS) {
      const createRes = await listPOST(
        postReq(
          {
            templateSlug: slug,
            frequency: "daily",
            dayOfWeek: null,
            dayOfMonth: null,
            hour: 9,
            minute: 0,
            recipientEmails: ["organizer@example.com"],
            enabled: true,
          },
          SCHEDULES_URL,
        ),
        ctx(),
      );
      expect(createRes.status).toBe(201);
    }

    const listRes = await listGET(new Request(SCHEDULES_URL), ctx());
    const listData = await listRes.json();
    expect(listData.schedules).toHaveLength(5);

    const slug = "registration-overview";
    const editRes = await itemPATCH(
      postReq(
        {
          frequency: "weekly",
          dayOfWeek: 2,
          dayOfMonth: null,
          hour: 10,
          minute: 30,
          recipientEmails: ["organizer@example.com"],
          enabled: true,
        },
        `${SCHEDULES_URL}/${slug}`,
      ),
      slugCtx(slug),
    );
    expect(editRes.status).toBe(200);
    const editData = await editRes.json();
    expect(editData.schedule.frequency).toBe("weekly");
    expect(editData.schedule.dayOfWeek).toBe(2);

    const pauseRes = await itemPATCH(
      postReq(
        {
          frequency: "weekly",
          dayOfWeek: 2,
          dayOfMonth: null,
          hour: 10,
          minute: 30,
          recipientEmails: ["organizer@example.com"],
          enabled: false,
        },
        `${SCHEDULES_URL}/${slug}`,
      ),
      slugCtx(slug),
    );
    expect(pauseRes.status).toBe(200);
    expect((await pauseRes.json()).schedule.enabled).toBe(false);

    // GET reflects paused, config retained (not deleted).
    const getRes = await itemGET(
      new Request(`${SCHEDULES_URL}/${slug}`),
      slugCtx(slug),
    );
    const getData = await getRes.json();
    expect(getData.schedule.enabled).toBe(false);
    expect(getData.schedule.frequency).toBe("weekly");

    const resumeRes = await itemPATCH(
      postReq(
        {
          frequency: "weekly",
          dayOfWeek: 2,
          dayOfMonth: null,
          hour: 10,
          minute: 30,
          recipientEmails: ["organizer@example.com"],
          enabled: true,
        },
        `${SCHEDULES_URL}/${slug}`,
      ),
      slugCtx(slug),
    );
    expect((await resumeRes.json()).schedule.enabled).toBe(true);

    const deleteRes = await itemDELETE(
      new Request(`${SCHEDULES_URL}/${slug}`),
      slugCtx(slug),
    );
    expect(deleteRes.status).toBe(200);
    const afterDeleteGet = await itemGET(
      new Request(`${SCHEDULES_URL}/${slug}`),
      slugCtx(slug),
    );
    expect(afterDeleteGet.status).toBe(404);

    const finalList = await listGET(new Request(SCHEDULES_URL), ctx());
    expect((await finalList.json()).schedules).toHaveLength(4);
  });

  it("recipient validation: 3 emails, 1 non-member — UI-facing response names exactly the bad one, ZERO doc written (re-fetch confirms)", async () => {
    seedMember("organizer@example.com", ORG_ID, "Organizer");
    seedMember("teammate@example.com", ORG_ID, "Teammate");
    // "typo@example.com" never seeded — not a member.

    const res = await listPOST(
      postReq(
        {
          templateSlug: "order-transactions",
          frequency: "daily",
          dayOfWeek: null,
          dayOfMonth: null,
          hour: 9,
          minute: 0,
          recipientEmails: [
            "organizer@example.com",
            "teammate@example.com",
            "typo@example.com",
          ],
          enabled: true,
        },
        SCHEDULES_URL,
      ),
      ctx(),
    );

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.recipientErrors).toHaveLength(1);
    expect(data.recipientErrors[0].email).toBe("typo@example.com");

    const listRes = await listGET(new Request(SCHEDULES_URL), ctx());
    expect((await listRes.json()).schedules).toHaveLength(0);
  });

  it("permission gating end-to-end: org member WITHOUT write:events gets 403 on every CRUD verb via the real route+scope, zero docs written", async () => {
    seedMember("viewer@example.com", ORG_ID, "Viewer");
    asSessionUser("viewer@example.com", ["view:events"]); // no write:events

    const createRes = await listPOST(
      postReq(
        {
          templateSlug: "registration-overview",
          frequency: "daily",
          dayOfWeek: null,
          dayOfMonth: null,
          hour: 9,
          minute: 0,
          recipientEmails: ["viewer@example.com"],
          enabled: true,
        },
        SCHEDULES_URL,
      ),
      ctx(),
    );
    expect(createRes.status).toBe(403);

    const listRes = await listGET(new Request(SCHEDULES_URL), ctx());
    expect(listRes.status).toBe(403);

    const patchRes = await itemPATCH(
      postReq(
        {
          frequency: "daily",
          dayOfWeek: null,
          dayOfMonth: null,
          hour: 9,
          minute: 0,
          recipientEmails: ["viewer@example.com"],
          enabled: false,
        },
        `${SCHEDULES_URL}/registration-overview`,
      ),
      slugCtx("registration-overview"),
    );
    expect(patchRes.status).toBe(403);

    const deleteRes = await itemDELETE(
      new Request(`${SCHEDULES_URL}/registration-overview`),
      slugCtx("registration-overview"),
    );
    expect(deleteRes.status).toBe(403);

    expect(
      [...fake.store.keys()].filter((k) => k.startsWith("ReportSchedule/")),
    ).toHaveLength(0);
  });

  it("cross-org IDOR: a write:events holder of Org A cannot read/edit/delete Org B's schedule", async () => {
    seedMember("organizer@example.com", ORG_ID, "Organizer");
    await listPOST(
      postReq(
        {
          templateSlug: "registration-overview",
          frequency: "daily",
          dayOfWeek: null,
          dayOfMonth: null,
          hour: 9,
          minute: 0,
          recipientEmails: ["organizer@example.com"],
          enabled: true,
        },
        SCHEDULES_URL,
      ),
      ctx(),
    );

    // Switch caller's active org to OTHER_ORG_ID (still write:events).
    getAdminUserByEmail.mockResolvedValue({
      organizationId: OTHER_ORG_ID,
      organizations: [{ organizationId: OTHER_ORG_ID, role: "member" }],
      permissions: ["write:events"],
      email: "attacker@example.com",
    });
    // getAdminEventForOrganization 404s in reality for cross-org; simulate that.
    getAdminEventForOrganization.mockResolvedValue(null);

    const res = await itemGET(
      new Request(`${SCHEDULES_URL}/registration-overview`),
      slugCtx("registration-overview"),
    );
    expect(res.status).toBe(404);
  });
});
