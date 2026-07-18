// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Timestamp } from "firebase-admin/firestore";

import type { EventDoc, WithId } from "@/types/collection";

const dal = vi.hoisted(() => ({
  attendees: vi.fn(),
  checkin: vi.fn(),
  messages: vi.fn(),
  page: vi.fn(),
  fees: vi.fn(),
  form: vi.fn(),
  orders: vi.fn(),
  drafts: vi.fn(),
  paths: vi.fn(),
  tickets: vi.fn(),
  definition: vi.fn(),
}));

vi.mock("@/lib/db/adminAttendee", () => ({
  countAdminAttendeesForEvent: dal.attendees,
}));
vi.mock("@/lib/db/adminCheckinConfig", () => ({
  hasAdminCheckinConfigForEvent: dal.checkin,
}));
vi.mock("@/lib/db/adminEmailMessage", () => ({
  countAdminEmailMessagesForEvent: dal.messages,
}));
vi.mock("@/lib/db/adminEventPage", () => ({
  getAdminEventPageForEvent: dal.page,
}));
vi.mock("@/lib/db/adminFee", () => ({ getAdminFeesForEvent: dal.fees }));
vi.mock("@/lib/db/adminForm", () => ({ getAdminFormForEvent: dal.form }));
vi.mock("@/lib/db/adminOrder", () => ({
  sumAdminOrderTotalsForEvent: dal.orders,
}));
vi.mock("@/lib/db/adminRegistrationDraft", () => ({
  countAdminAbandonedRegistrationDraftsForEvent: dal.drafts,
}));
vi.mock("@/lib/db/adminRegistrationPath", () => ({
  getAdminRegistrationPathsForEvent: dal.paths,
}));
vi.mock("@/lib/db/adminTicketType", () => ({
  getAdminTicketTypesForEvent: dal.tickets,
}));
vi.mock("@/features/emails/server/resolve-definition", () => ({
  resolveEffectiveEmailDefinition: dal.definition,
}));

const { loadEventOverview } = await import(
  "@/features/event/overview/event-overview-loader"
);

function event(overrides: Partial<EventDoc> = {}): WithId<EventDoc> {
  return {
    id: "evt-1",
    allowOverlap: false,
    capacity: 100,
    createdAt: Timestamp.fromMillis(1),
    description: "",
    expectedGuests: 100,
    formPath: "Form/form-1",
    invoicePath: "",
    name: "Parity Conf",
    organizationPath: "Organization/org-1",
    pageMode: "custom",
    redirectUrl: "",
    periods: [],
    status: "Published",
    timezone: "Asia/Singapore",
    updatedAt: Timestamp.fromMillis(2),
    ...overrides,
  };
}

function primeDone() {
  dal.attendees.mockResolvedValue(12);
  dal.messages.mockResolvedValue(8);
  dal.drafts.mockResolvedValue(3);
  dal.paths.mockResolvedValue([
    { id: "path-card", isActive: true, paymentMethod: "card", currency: "USD" },
    { id: "path-invoice", isActive: true, paymentMethod: "invoice", currency: "GBP" },
  ]);
  dal.orders.mockImplementation(async ({ currency }: { currency: string }) =>
    currency === "GBP" ? 200 : 100,
  );
  dal.page.mockResolvedValue({ status: "published" });
  dal.form.mockResolvedValue({ status: "published" });
  dal.tickets.mockResolvedValue([{ id: "ticket-1" }]);
  dal.fees.mockResolvedValue([{ ticketTypeId: "ticket-1", status: "active" }]);
  dal.definition.mockResolvedValue({ enabled: true });
  dal.checkin.mockResolvedValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  primeDone();
});

describe("loadEventOverview", () => {
  it("returns every checklist TRUE case in fixed order and shapes metrics/identity", async () => {
    const result = await loadEventOverview({
      event: event(),
      eventId: "evt-1",
      organizationId: "org-1",
    });

    expect(result.registered).toEqual({ value: 12 });
    expect(result.invited).toEqual({ value: 8 });
    expect(result.abandoned).toEqual({ value: 3 });
    expect(result.revenue).toEqual({
      kind: "currencies",
      amounts: [
        { currency: "GBP", paidMinor: 200 },
        { currency: "USD", paidMinor: 100 },
      ],
    });
    expect(result.identity).toEqual({
      category: "Not set",
      timezone: "Asia/Singapore",
      visibility: "Public",
      paths: { active: 2, total: 2, methods: ["card", "invoice"] },
    });
    expect(result.readiness.map(({ id, state }) => ({ id, state }))).toEqual([
      { id: "event-published", state: "done" },
      { id: "custom-page-published", state: "done" },
      { id: "registration-form-published", state: "done" },
      { id: "ticket-types-pricing-set", state: "done" },
      { id: "confirmation-email-active", state: "done" },
      { id: "checkin-configured", state: "done" },
    ]);
    expect(dal.attendees).toHaveBeenCalledWith({
      eventId: "evt-1",
      organizationId: "org-1",
      status: "accepted",
    });
    expect(dal.messages).toHaveBeenCalledWith({
      eventId: "evt-1",
      organizationId: "org-1",
      kind: "invitation",
      status: "sent",
    });
  });

  it("returns every checklist FALSE case and the honest zero-path identity/revenue", async () => {
    dal.paths.mockResolvedValue([]);
    dal.page.mockResolvedValue(null);
    dal.form.mockResolvedValue(null);
    dal.tickets.mockResolvedValue([]);
    dal.fees.mockResolvedValue([]);
    dal.definition.mockResolvedValue({ enabled: false });
    dal.checkin.mockResolvedValue(false);

    const result = await loadEventOverview({
      event: event({ status: "Draft" }),
      eventId: "evt-1",
      organizationId: "org-1",
    });

    expect(result.revenue).toEqual({ kind: "unconfigured" });
    expect(result.identity.visibility).toBe("Private (draft)");
    expect(result.identity.paths).toEqual({ active: 0, total: 0, methods: [] });
    expect(result.readiness).toHaveLength(6);
    expect(result.readiness.every((entry) => entry.state === "pending")).toBe(
      true,
    );
    expect(dal.definition).toHaveBeenCalledTimes(2);
  });

  it("marks custom-page readiness done without reading meaning into page absence for default/redirect modes", async () => {
    dal.page.mockResolvedValue(null);
    for (const pageMode of ["default", "redirect"] as const) {
      const result = await loadEventOverview({
        event: event({ pageMode }),
        eventId: "evt-1",
        organizationId: "org-1",
      });
      expect(result.readiness[1]).toMatchObject({
        state: "done",
        detail: `Not required for ${pageMode} page mode`,
      });
    }
  });

  it("degrades each failed section without blanking successful sections", async () => {
    dal.attendees.mockRejectedValue(new Error("attendees"));
    dal.paths.mockRejectedValue(new Error("paths"));
    dal.page.mockRejectedValue(new Error("page"));
    dal.form.mockRejectedValue(new Error("form"));
    dal.tickets.mockRejectedValue(new Error("tickets"));
    dal.checkin.mockRejectedValue(new Error("checkin"));

    const result = await loadEventOverview({
      event: event(),
      eventId: "evt-1",
      organizationId: "org-1",
    });

    expect(result.registered).toEqual({ loadError: true });
    expect(result.invited).toEqual({ value: 8 });
    expect(result.abandoned).toEqual({ value: 3 });
    expect(result.revenue).toEqual({ loadError: true });
    expect(result.identity.paths).toEqual({ loadError: true });
    expect(result.readiness.map((entry) => entry.state)).toEqual([
      "done",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
  });

  it("makes an order fan-out failure fail Revenue only", async () => {
    dal.orders.mockRejectedValue(new Error("order aggregate"));
    const result = await loadEventOverview({
      event: event(),
      eventId: "evt-1",
      organizationId: "org-1",
    });

    expect(result.revenue).toEqual({ loadError: true });
    expect(result.registered).toEqual({ value: 12 });
    expect(result.identity.paths).toMatchObject({ active: 2, total: 2 });
    expect(result.readiness.every((entry) => entry.state === "done")).toBe(true);
  });
});
