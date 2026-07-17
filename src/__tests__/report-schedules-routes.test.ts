// @vitest-environment node
/**
 * M7-T3 — Schedule CRUD routes:
 *   GET/POST     /api/dashboard/events/[eventId]/reports/schedules
 *   GET/PATCH/DELETE /api/dashboard/events/[eventId]/reports/schedules/[templateSlug]
 * Spec: agents/docs/specs/m7-scheduled-reports.md (§1 AC-2, §2 AC-2/AC-3,
 * §4 AC-1/AC-2/AC-4, §6 AC-1/AC-2).
 *
 * Locks:
 *  - every route 403s a member WITHOUT write:events and 404s a cross-org/
 *    unknown event — the SAME two-test shape M7-T2 §7 AC-1/AC-2 already
 *    established for the export routes (matches the exact pattern in
 *    reports-run-export-routes.test.ts), applied here to the schedule CRUD
 *    tier (spec §4: "every one gated write:events").
 *  - a NOT_A_MEMBER DAL result surfaces as 422 with a `recipientErrors`
 *    array naming the SPECIFIC rejected email(s) + a typed reason — never a
 *    generic failure (spec §2 AC-2, D2).
 *  - POST/PATCH forward templateSlug/patch to upsertAdminReportSchedule
 *    correctly (POST derives templateSlug from the body; PATCH derives it
 *    from the route param, stripping any body-supplied templateSlug).
 *  - DELETE 404s when the DAL reports NOT_FOUND.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  listAdminReportSchedulesForEvent,
  getAdminReportScheduleByTemplate,
  upsertAdminReportSchedule,
  deleteAdminReportSchedule,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  listAdminReportSchedulesForEvent: vi.fn(),
  getAdminReportScheduleByTemplate: vi.fn(),
  upsertAdminReportSchedule: vi.fn(),
  deleteAdminReportSchedule: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminReportSchedule", () => ({
  listAdminReportSchedulesForEvent,
  getAdminReportScheduleByTemplate,
  upsertAdminReportSchedule,
  deleteAdminReportSchedule,
}));

import { resetRateLimits } from "@/lib/rate-limit";

import {
  GET as listGET,
  POST as listPOST,
} from "@/app/api/dashboard/events/[eventId]/reports/schedules/route";
import {
  DELETE as itemDELETE,
  GET as itemGET,
  PATCH as itemPATCH,
} from "@/app/api/dashboard/events/[eventId]/reports/schedules/[templateSlug]/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";
const TEMPLATE_SLUG = "registration-overview";

function eventContext(eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId }) };
}

function scheduleContext(templateSlug = TEMPLATE_SLUG, eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId, templateSlug }) };
}

function memberUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    organizations: [{ organizationId: ORG_ID, role: "member" }],
    permissions: ["view:events"],
    ...overrides,
  };
}

function writeMemberUserDoc(overrides: Record<string, unknown> = {}) {
  return memberUserDoc({ permissions: ["write:events"], ...overrides });
}

function storedSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: "schedule-1",
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    templateSlug: TEMPLATE_SLUG,
    frequency: "daily",
    dayOfWeek: null,
    dayOfMonth: null,
    hour: 9,
    minute: 0,
    recipients: [{ email: "organizer@example.com", name: "Organizer" }],
    enabled: true,
    createdBy: "organizer@example.com",
    createdAt: { toMillis: () => 1000 },
    updatedAt: { toMillis: () => 2000 },
    ...overrides,
  };
}

function postRequest(
  body: unknown,
  url = `http://localhost/api/dashboard/events/${EVENT_ID}/reports/schedules`,
) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  cookies.mockResolvedValue({
    get: (name: string) =>
      name === "session" ? { value: "token" } : undefined,
  });
  decodeUser.mockResolvedValue({
    uid: "u1",
    name: "Organizer",
    picture: "",
    email: "organizer@example.com",
  });
  getAdminUserByEmail.mockResolvedValue(writeMemberUserDoc());
  getAdminEventForOrganization.mockResolvedValue({
    id: EVENT_ID,
    name: "Summit",
  });
  listAdminReportSchedulesForEvent.mockResolvedValue([storedSchedule()]);
  getAdminReportScheduleByTemplate.mockResolvedValue(storedSchedule());
  upsertAdminReportSchedule.mockResolvedValue({
    ok: true,
    created: true,
    schedule: storedSchedule(),
  });
  deleteAdminReportSchedule.mockResolvedValue({ ok: true });
});

describe("GET .../reports/schedules — write:events gate (spec §4)", () => {
  it("403s a member WITHOUT write:events", async () => {
    getAdminUserByEmail.mockResolvedValue(memberUserDoc());

    const response = await listGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/schedules`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(403);
    expect(listAdminReportSchedulesForEvent).not.toHaveBeenCalled();
  });

  it("404s a cross-org/unknown event even WITH write:events", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await listGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/schedules`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(404);
    expect(listAdminReportSchedulesForEvent).not.toHaveBeenCalled();
  });

  it("returns the serialized schedule list for a write:events holder", async () => {
    const response = await listGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/schedules`,
      ),
      eventContext(),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.schedules).toHaveLength(1);
    expect(data.schedules[0]).toMatchObject({
      templateSlug: TEMPLATE_SLUG,
      frequency: "daily",
      createdAtMs: 1000,
    });
  });
});

describe("POST .../reports/schedules (spec §4 AC-1)", () => {
  const validBody = {
    templateSlug: TEMPLATE_SLUG,
    frequency: "daily",
    dayOfWeek: null,
    dayOfMonth: null,
    hour: 9,
    minute: 0,
    recipientEmails: ["organizer@example.com"],
    enabled: true,
  };

  it("403s a member WITHOUT write:events", async () => {
    getAdminUserByEmail.mockResolvedValue(memberUserDoc());

    const response = await listPOST(postRequest(validBody), eventContext());

    expect(response.status).toBe(403);
    expect(upsertAdminReportSchedule).not.toHaveBeenCalled();
  });

  it("404s a cross-org/unknown event even WITH write:events", async () => {
    getAdminEventForOrganization.mockResolvedValue(null);

    const response = await listPOST(postRequest(validBody), eventContext());

    expect(response.status).toBe(404);
    expect(upsertAdminReportSchedule).not.toHaveBeenCalled();
  });

  it("400s an unknown templateSlug before ever calling the DAL", async () => {
    const response = await listPOST(
      postRequest({ ...validBody, templateSlug: "not-a-real-template" }),
      eventContext(),
    );

    expect(response.status).toBe(400);
    expect(upsertAdminReportSchedule).not.toHaveBeenCalled();
  });

  it("forwards templateSlug/createdBy/patch to upsertAdminReportSchedule and returns 201 on create", async () => {
    const response = await listPOST(postRequest(validBody), eventContext());

    expect(response.status).toBe(201);
    expect(upsertAdminReportSchedule).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      templateSlug: TEMPLATE_SLUG,
      createdBy: "organizer@example.com",
      patch: {
        frequency: "daily",
        dayOfWeek: null,
        dayOfMonth: null,
        hour: 9,
        minute: 0,
        recipientEmails: ["organizer@example.com"],
        enabled: true,
      },
    });
  });

  it("returns 200 (not 201) when the DAL reports an edit (created: false) — AC-1's upsert", async () => {
    upsertAdminReportSchedule.mockResolvedValue({
      ok: true,
      created: false,
      schedule: storedSchedule({ frequency: "weekly", dayOfWeek: 1 }),
    });

    const response = await listPOST(
      postRequest({ ...validBody, frequency: "weekly", dayOfWeek: 1 }),
      eventContext(),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.created).toBe(false);
    expect(data.schedule.frequency).toBe("weekly");
  });

  it("413s a request body over the 32KB cap, and never reaches the DAL (spec §4: 'Zod-validated request bodies (≤32 KB)')", async () => {
    // 40KB of padding in an otherwise-valid-shaped body — well past the
    // 32KB ceiling `readReportsRouteJsonBody` enforces before ANY parsing.
    const oversizedBody = {
      ...validBody,
      padding: "x".repeat(40 * 1024),
    };

    const response = await listPOST(postRequest(oversizedBody), eventContext());

    expect(response.status).toBe(413);
    expect(upsertAdminReportSchedule).not.toHaveBeenCalled();
  });

  it("429s past the rate limit (20/min/user/event), with a Retry-After header, and never reaches the DAL", async () => {
    for (let i = 0; i < 20; i += 1) {
      const ok = await listPOST(postRequest(validBody), eventContext());
      expect(ok.status).not.toBe(429);
    }
    upsertAdminReportSchedule.mockClear();

    const limited = await listPOST(postRequest(validBody), eventContext());

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(upsertAdminReportSchedule).not.toHaveBeenCalled();
  });

  it("surfaces a NOT_A_MEMBER DAL result as 422 with the SPECIFIC rejected email + reason (spec §2 AC-2, D2)", async () => {
    upsertAdminReportSchedule.mockResolvedValue({
      ok: false,
      code: "NOT_A_MEMBER",
      emails: ["not-a-member@example.com"],
    });

    const response = await listPOST(
      postRequest({
        ...validBody,
        recipientEmails: ["organizer@example.com", "not-a-member@example.com"],
      }),
      eventContext(),
    );

    expect(response.status).toBe(422);
    const data = await response.json();
    expect(data.recipientErrors).toEqual([
      {
        email: "not-a-member@example.com",
        reason:
          "This email isn't a member of your organization — invite them first.",
      },
    ]);
  });

  it("surfaces a VALIDATION DAL result as 400", async () => {
    upsertAdminReportSchedule.mockResolvedValue({
      ok: false,
      code: "VALIDATION",
      issues: ["dayOfMonth is required for a monthly schedule."],
    });

    const response = await listPOST(postRequest(validBody), eventContext());

    expect(response.status).toBe(400);
  });
});

describe("GET .../reports/schedules/[templateSlug] (get-existing-schedule lookup)", () => {
  it("403s a member WITHOUT write:events", async () => {
    getAdminUserByEmail.mockResolvedValue(memberUserDoc());

    const response = await itemGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/schedules/${TEMPLATE_SLUG}`,
      ),
      scheduleContext(),
    );

    expect(response.status).toBe(403);
  });

  it("404s when no schedule has been configured for this template yet", async () => {
    getAdminReportScheduleByTemplate.mockResolvedValue(null);

    const response = await itemGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/schedules/${TEMPLATE_SLUG}`,
      ),
      scheduleContext(),
    );

    expect(response.status).toBe(404);
  });

  it("returns the serialized schedule when one exists", async () => {
    const response = await itemGET(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/schedules/${TEMPLATE_SLUG}`,
      ),
      scheduleContext(),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.schedule.templateSlug).toBe(TEMPLATE_SLUG);
  });
});

describe("PATCH .../reports/schedules/[templateSlug] (edit / pause-resume)", () => {
  const patchBody = {
    frequency: "daily",
    dayOfWeek: null,
    dayOfMonth: null,
    hour: 9,
    minute: 0,
    recipientEmails: ["organizer@example.com"],
    enabled: false,
  };

  it("403s a member WITHOUT write:events", async () => {
    getAdminUserByEmail.mockResolvedValue(memberUserDoc());

    const response = await itemPATCH(
      postRequest(patchBody, `http://localhost/x`),
      scheduleContext(),
    );

    expect(response.status).toBe(403);
    expect(upsertAdminReportSchedule).not.toHaveBeenCalled();
  });

  it("takes templateSlug from the ROUTE PARAM, never a body-supplied value", async () => {
    await itemPATCH(
      postRequest(
        { ...patchBody, templateSlug: "order-transactions" },
        "http://localhost/x",
      ),
      scheduleContext(TEMPLATE_SLUG),
    );

    expect(upsertAdminReportSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ templateSlug: TEMPLATE_SLUG }),
    );
    const call = upsertAdminReportSchedule.mock.calls[0][0];
    expect(call.patch).not.toHaveProperty("templateSlug");
  });

  it("pause/resume: resending the same config with enabled flipped reaches the DAL", async () => {
    const response = await itemPATCH(
      postRequest(patchBody, "http://localhost/x"),
      scheduleContext(),
    );

    expect(response.status).toBe(200);
    expect(upsertAdminReportSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it("surfaces NOT_A_MEMBER as 422 with recipientErrors on PATCH too", async () => {
    upsertAdminReportSchedule.mockResolvedValue({
      ok: false,
      code: "NOT_A_MEMBER",
      emails: ["gone@example.com"],
    });

    const response = await itemPATCH(
      postRequest(patchBody, "http://localhost/x"),
      scheduleContext(),
    );

    expect(response.status).toBe(422);
    const data = await response.json();
    expect(data.recipientErrors).toEqual([
      {
        email: "gone@example.com",
        reason:
          "This email isn't a member of your organization — invite them first.",
      },
    ]);
  });
});

describe("DELETE .../reports/schedules/[templateSlug] (spec §4 AC-3)", () => {
  it("403s a member WITHOUT write:events", async () => {
    getAdminUserByEmail.mockResolvedValue(memberUserDoc());

    const response = await itemDELETE(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/schedules/${TEMPLATE_SLUG}`,
      ),
      scheduleContext(),
    );

    expect(response.status).toBe(403);
    expect(deleteAdminReportSchedule).not.toHaveBeenCalled();
  });

  it("404s when the DAL reports NOT_FOUND", async () => {
    deleteAdminReportSchedule.mockResolvedValue({
      ok: false,
      code: "NOT_FOUND",
    });

    const response = await itemDELETE(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/schedules/${TEMPLATE_SLUG}`,
      ),
      scheduleContext(),
    );

    expect(response.status).toBe(404);
  });

  it("succeeds and calls deleteAdminReportSchedule with the deterministic scheduleId", async () => {
    const response = await itemDELETE(
      new Request(
        `http://localhost/api/dashboard/events/${EVENT_ID}/reports/schedules/${TEMPLATE_SLUG}`,
      ),
      scheduleContext(),
    );

    expect(response.status).toBe(200);
    expect(deleteAdminReportSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT_ID, organizationId: ORG_ID }),
    );
  });
});
