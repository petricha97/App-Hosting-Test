import { render, screen } from "@testing-library/react";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const rows = new Map<string, Row>();

function comparable(value: unknown) {
  return value && typeof value === "object" && "toMillis" in value
    ? (value as { toMillis(): number }).toMillis()
    : value;
}

function collection(name: string) {
  const query = (filters: Array<[string, string, unknown]> = []) => ({
    where(field: string, op: string, value: unknown) {
      return query([...filters, [field, op, value]]);
    },
    orderBy() { return this; },
    limit() { return this; },
    async get() {
      const docs = matches(name, filters).map(([path, data]) => ({ id: path.split("/").pop()!, data: () => data }));
      return { docs, empty: docs.length === 0 };
    },
    count() {
      return { async get() { return { data: () => ({ count: matches(name, filters).length }) }; } };
    },
    aggregate(spec: Record<string, { aggregateType: string; _field?: string }>) {
      return { async get() {
        const found = matches(name, filters);
        return { data: () => Object.fromEntries(Object.entries(spec).map(([key, field]) => {
          if (field.aggregateType === "count") return [key, found.length];
          const path = String(field._field).split(".");
          return [key, found.reduce((sum, [, row]) => sum + Number(path.reduce<unknown>((value, part) => (value as Row)?.[part], row) ?? 0), 0)];
        })) };
      } };
    },
  });
  return {
    ...query(),
    doc(id: string) {
      return { async get() { const data = rows.get(`${name}/${id}`); return { exists: data !== undefined, id, data: () => data }; } };
    },
  };
}

function matches(name: string, filters: Array<[string, string, unknown]>) {
  return [...rows.entries()].filter(([path, row]) => path.startsWith(`${name}/`) && filters.every(([field, op, wanted]) => {
    const actual = comparable(row[field]);
    const expected = comparable(wanted);
    if (op === "==") return actual === expected;
    if (op === "<") return (actual as number) < (expected as number);
    throw new Error(`Unsupported operator ${op}`);
  }));
}

vi.mock("@/app/lib/firestore", () => ({ adminDb: { collection } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/dashboard/events/evt-owned/pricing",
}));

const { emailDefinitionId } = await import("@/lib/db/emailDefinitionId");
const { loadEventOverview } = await import("@/features/event/overview/event-overview-loader");
const { EventOverview } = await import("@/features/event/overview/event-overview");
const { EventShell } = await import("@/features/event/components/event-shell");

const now = Date.now();
const event = {
  id: "evt-owned", allowOverlap: false, capacity: 100, createdAt: Timestamp.fromMillis(1),
  description: "", expectedGuests: 100, formPath: "", invoicePath: "", name: "QA Summit",
  organizationPath: "Organization/org-owned", pageMode: "default" as const, redirectUrl: "",
  periods: [], status: "Published" as const, timezone: "Asia/Singapore", updatedAt: Timestamp.fromMillis(2),
};

function seed(collectionName: string, id: string, data: Row) { rows.set(`${collectionName}/${id}`, data); }
function owned(data: Row = {}) { return { organizationId: "org-owned", eventId: "evt-owned", ...data }; }
function definition(kind: string, enabled: boolean, organizationId = "org-owned") {
  seed("EmailDefinition", emailDefinitionId({ organizationId, eventId: "evt-owned", kind }), {
    organizationId, eventId: "evt-owned", kind, enabled, subject: "Subject", body: "Body",
  });
}

beforeEach(() => rows.clear());

describe("M8-T3 QA — real loader and DAL integration", () => {
  it("renders exact hand-computed metrics and excludes every other-tenant contribution", async () => {
    seed("Attendee", "accepted-1", owned({ status: "accepted" }));
    seed("Attendee", "accepted-2", owned({ status: "accepted" }));
    seed("Attendee", "cancelled", owned({ status: "cancelled" }));
    seed("EmailMessage", "sent-invite", owned({ kind: "invitation", status: "sent" }));
    seed("EmailMessage", "queued-invite", owned({ kind: "invitation", status: "queued" }));
    seed("EmailMessage", "sent-other-kind", owned({ kind: "approval-pending", status: "sent" }));
    seed("RegistrationPath", "usd", owned({ isActive: true, paymentMethod: "card", currency: "USD", sortOrder: 1 }));
    seed("RegistrationPath", "sgd", owned({ isActive: true, paymentMethod: "invoice", currency: "SGD", sortOrder: 2 }));
    seed("Order", "usd-paid", owned({ currency: "USD", paymentStatus: "paid", amounts: { totalMinor: 12345 } }));
    seed("Order", "sgd-paid", owned({ currency: "SGD", paymentStatus: "paid", amounts: { totalMinor: 67890 } }));
    seed("Order", "usd-outstanding", owned({ currency: "USD", paymentStatus: "outstanding", amounts: { totalMinor: 999999 } }));
    seed("RegistrationDraft", "abandoned", owned({ updatedAt: Timestamp.fromMillis(now - 86_400_001) }));
    seed("RegistrationDraft", "fresh", owned({ updatedAt: Timestamp.fromMillis(now) }));
    seed("Attendee", "foreign", { organizationId: "org-other", eventId: "evt-owned", status: "accepted" });
    seed("EmailMessage", "foreign", { organizationId: "org-other", eventId: "evt-owned", kind: "invitation", status: "sent" });
    seed("Order", "foreign", { organizationId: "org-other", eventId: "evt-owned", currency: "USD", paymentStatus: "paid", amounts: { totalMinor: 500000 } });
    seed("RegistrationDraft", "foreign", { organizationId: "org-other", eventId: "evt-owned", updatedAt: Timestamp.fromMillis(now - 90_000_000) });
    definition("confirmation-paid", true);
    definition("confirmation-payment-due", true);

    const data = await loadEventOverview({ event, eventId: event.id, organizationId: "org-owned" });
    render(<EventOverview eventId={event.id} data={data} promotions={[]} availableTemplates={[]} />);

    expect(data.registered).toEqual({ value: 2 });
    expect(data.invited).toEqual({ value: 1 });
    expect(data.abandoned).toEqual({ value: 1 });
    expect(data.revenue).toEqual({ kind: "currencies", amounts: [
      { currency: "SGD", paidMinor: 67890 }, { currency: "USD", paidMinor: 12345 },
    ] });
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText(/SGD\s+678\.90/)).toBeTruthy();
    expect(screen.getByText("$123.45")).toBeTruthy();
    expect(screen.queryByText(/5,123\.45/)).toBeNull();
    expect(data.identity.paths).toEqual({ active: 2, total: 2, methods: ["card", "invoice"] });
  });

  it("rejects archived and dangling Fee references for ticket/pricing readiness", async () => {
    seed("TicketType", "ticket", owned({ createdAt: Timestamp.fromMillis(1) }));
    seed("Fee", "archived", owned({ ticketTypeId: "ticket", status: "archived", createdAt: Timestamp.fromMillis(1) }));
    seed("Fee", "dangling", owned({ ticketTypeId: "missing", status: "active", createdAt: Timestamp.fromMillis(2) }));
    const data = await loadEventOverview({ event, eventId: event.id, organizationId: "org-owned" });
    expect(data.readiness[3]).toMatchObject({ id: "ticket-types-pricing-set", state: "pending" });
  });

  it("renders another event screen through EventShell without a statusAction slot", () => {
    render(<EventShell eventId={event.id} event={{ id: event.id, name: event.name, status: event.status, dateLabel: "July 19", venue: "Singapore" }}><div>Pricing screen</div></EventShell>);
    expect(screen.getByText("Pricing screen")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Preview/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Publish|draft/i })).toBeNull();
  });

  it.each([
    ["card only", ["card"], ["confirmation-paid"]],
    ["invoice only", ["invoice"], ["confirmation-payment-due"]],
    ["mixed", ["card", "invoice"], ["confirmation-paid", "confirmation-payment-due"]],
    ["zero active paths", [], ["confirmation-paid", "confirmation-payment-due"]],
  ])("requires the correct confirmation kinds for %s", async (_label, methods, required) => {
    (methods as string[]).forEach((paymentMethod, index) => seed("RegistrationPath", `path-${index}`, owned({ isActive: true, paymentMethod, currency: "USD", sortOrder: index })));
    for (const kind of ["confirmation-paid", "confirmation-payment-due"]) definition(kind, (required as string[]).includes(kind));
    let data = await loadEventOverview({ event, eventId: event.id, organizationId: "org-owned" });
    expect(data.readiness[4].state).toBe("done");

    definition((required as string[])[0], false);
    data = await loadEventOverview({ event, eventId: event.id, organizationId: "org-owned" });
    expect(data.readiness[4].state).toBe("pending");
  });
});
