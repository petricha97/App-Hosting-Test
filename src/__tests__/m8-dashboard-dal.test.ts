// @vitest-environment node
/**
 * M8-T2 — workspace dashboard org-scoped DAL additions.
 * Spec: agents/docs/specs/m8-dashboard-metrics.md §4/§5.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

import type {
  AttendeeDoc,
  OrderDoc,
  RegistrationPathDoc,
} from "@/types/collection";

const { countAdminAttendeesForOrganization } = await import(
  "@/lib/db/adminAttendee"
);
const { sumAdminOrderTotalsForOrganization } = await import(
  "@/lib/db/adminOrder"
);
const { getAdminRegistrationPathsForOrganization } = await import(
  "@/lib/db/adminRegistrationPath"
);

const ORG_ID = "org-1";
const OTHER_ORG_ID = "org-2";

function seedAttendee(id: string, overrides: Partial<AttendeeDoc> = {}) {
  fake.store.set(`Attendee/${id}`, {
    organizationId: ORG_ID,
    eventId: "evt-1",
    submissionId: `sub-${id}`,
    orderId: null,
    pathId: null,
    firstName: "Ada",
    lastName: "Lovelace",
    email: `${id}@example.com`,
    company: "",
    jobTitle: "",
    registrationTypeId: null,
    registrationTypeLabel: "-",
    ticketTypeId: null,
    ticketLabel: "-",
    status: "accepted",
    checkInState: "not-arrived",
    checkedInAt: null,
    checkedInBy: null,
    qrTokenHash: "a".repeat(64),
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

function seedOrder(id: string, overrides: Partial<OrderDoc> = {}) {
  fake.store.set(`Order/${id}`, {
    organizationId: ORG_ID,
    eventId: "evt-1",
    submissionId: `sub-${id}`,
    ticketTypeId: "tt-1",
    registrationTypeId: "rt-1",
    feeId: "fee-1",
    promotionId: null,
    taxIds: [],
    currency: "USD",
    amounts: {
      subtotalMinor: 1000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 1000,
    },
    snapshot: {
      feeName: "Standard",
      basePriceMinor: 1000,
      promoCode: null,
      discountType: null,
      discountValue: null,
      taxLines: [],
    },
    paymentMethod: "card",
    paymentStatus: "paid",
    paymentProvider: "simulated",
    providerPaymentId: null,
    idempotencyKey: id,
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

function seedPath(id: string, overrides: Partial<RegistrationPathDoc> = {}) {
  fake.store.set(`RegistrationPath/${id}`, {
    organizationId: ORG_ID,
    eventId: "evt-1",
    name: `Path ${id}`,
    code: id.toUpperCase(),
    audienceRegistrationTypeId: null,
    paymentMethod: "card",
    currency: "USD",
    isActive: true,
    sortOrder: 0,
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("countAdminAttendeesForOrganization", () => {
  it("cross-checks 200 accepted attendees across six events without leakage", async () => {
    const attendeeFixtures = [
      ...Array.from({ length: 200 }, (_, index) => ({
        id: `a-${index}`,
        organizationId: ORG_ID,
        eventId: `evt-${(index % 6) + 1}`,
        status: "accepted" as const,
      })),
      {
        id: "a-cancelled",
        organizationId: ORG_ID,
        eventId: "evt-1",
        status: "cancelled" as const,
      },
      {
        id: "a-other-org",
        organizationId: OTHER_ORG_ID,
        eventId: "evt-3",
        status: "accepted" as const,
      },
    ];
    attendeeFixtures.forEach(({ id, ...fixture }) => seedAttendee(id, fixture));

    const bruteForceCount = attendeeFixtures.filter(
      (attendee) =>
        attendee.organizationId === ORG_ID && attendee.status === "accepted",
    ).length;

    const count = await countAdminAttendeesForOrganization({
      organizationId: ORG_ID,
      status: "accepted",
    });

    expect(count).toBe(bruteForceCount);
    expect(fake.queryDocReads).toBe(0);
  });
});

describe("sumAdminOrderTotalsForOrganization", () => {
  it("sums paid orders across events without cross-tenant or non-paid leakage", async () => {
    seedOrder("o-1", {
      eventId: "evt-1",
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 1200,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 1200,
      },
    });
    seedOrder("o-2", {
      eventId: "evt-2",
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 800,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 800,
      },
    });
    seedOrder("o-pending", {
      eventId: "evt-1",
      paymentStatus: "pending",
      amounts: {
        subtotalMinor: 9999,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 9999,
      },
    });
    seedOrder("o-failed", {
      paymentStatus: "failed",
      amounts: {
        subtotalMinor: 9999,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 9999,
      },
    });
    seedOrder("o-outstanding", {
      paymentStatus: "outstanding",
      amounts: {
        subtotalMinor: 9999,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 9999,
      },
    });
    seedOrder("o-comped", {
      paymentStatus: "comped",
      amounts: {
        subtotalMinor: 9999,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 9999,
      },
    });
    seedOrder("o-paid-gbp", {
      paymentStatus: "paid",
      currency: "GBP",
      amounts: {
        subtotalMinor: 7000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 7000,
      },
    });
    seedOrder("o-other-org", {
      organizationId: OTHER_ORG_ID,
      eventId: "evt-1",
      paymentStatus: "paid",
      amounts: {
        subtotalMinor: 500000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 500000,
      },
    });

    const total = await sumAdminOrderTotalsForOrganization({
      organizationId: ORG_ID,
      paymentStatus: "paid",
      currency: "USD",
      field: "totalMinor",
    });

    expect(total).toBe(2000);
    expect(fake.queryDocReads).toBe(0);
  });
});

describe("getAdminRegistrationPathsForOrganization", () => {
  it("enumerates org-wide paths across events without leaking another org", async () => {
    seedPath("p-1", { eventId: "evt-1", currency: "USD" });
    seedPath("p-2", { eventId: "evt-2", currency: "GBP" });
    seedPath("p-other-org", {
      organizationId: OTHER_ORG_ID,
      eventId: "evt-3",
      currency: "EUR",
    });

    const paths = await getAdminRegistrationPathsForOrganization({
      organizationId: ORG_ID,
    });

    expect(paths.map((path) => path.id).sort()).toEqual(["p-1", "p-2"]);
    expect(paths.map((path) => path.currency).sort()).toEqual(["GBP", "USD"]);
  });

  it("applies the optional safety limit", async () => {
    for (let i = 0; i < 5; i += 1) {
      seedPath(`p-${i}`, { eventId: `evt-${i}` });
    }

    const paths = await getAdminRegistrationPathsForOrganization({
      organizationId: ORG_ID,
      limit: 2,
    });

    expect(paths).toHaveLength(2);
  });
});
