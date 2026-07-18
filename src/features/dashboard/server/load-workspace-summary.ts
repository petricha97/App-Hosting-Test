import "server-only";

import { countAdminAttendeesForOrganization } from "@/lib/db/adminAttendee";
import { sumAdminOrderTotalsForOrganization } from "@/lib/db/adminOrder";
import { getAdminRegistrationPathsForOrganization } from "@/lib/db/adminRegistrationPath";
import type { Currency, EventDoc, WithId } from "@/types/collection";

export type WorkspaceRegistrationsSummary =
  | { value: number }
  | { loadError: true };

export type WorkspaceRevenueSummary =
  | { kind: "zero-currency" }
  | { kind: "single"; currency: Currency; paidMinor: number }
  | {
      kind: "multi";
      primaryCurrency: Currency;
      primaryPaidMinor: number;
      otherCurrencies: Array<{ currency: Currency; paidMinor: number }>;
    }
  | { loadError: true };

export interface WorkspaceSummary {
  draftCount: number;
  publishedCount: number;
  registrations: WorkspaceRegistrationsSummary;
  revenue: WorkspaceRevenueSummary;
  quickActionEvent: WithId<EventDoc> | null;
}

function countEventsByStatus(events: WithId<EventDoc>[]) {
  return events.reduce(
    (counts, event) => {
      if (event.status === "Draft") counts.draftCount += 1;
      if (event.status === "Published") counts.publishedCount += 1;
      return counts;
    },
    { draftCount: 0, publishedCount: 0 },
  );
}

function resolvePrimaryCurrency(paths: Array<{ currency: Currency }>) {
  const counts = new Map<Currency, number>();

  for (const path of paths) {
    counts.set(path.currency, (counts.get(path.currency) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort(
    ([leftCurrency, leftCount], [rightCurrency, rightCount]) =>
      rightCount - leftCount || leftCurrency.localeCompare(rightCurrency),
  )[0]?.[0];
}

async function loadRegistrations(input: {
  organizationId: string;
}): Promise<WorkspaceRegistrationsSummary> {
  const value = await countAdminAttendeesForOrganization({
    organizationId: input.organizationId,
    status: "accepted",
  });

  return { value };
}

async function loadRevenue(input: {
  organizationId: string;
}): Promise<WorkspaceRevenueSummary> {
  const paths = await getAdminRegistrationPathsForOrganization({
    organizationId: input.organizationId,
  });
  const primaryCurrency = resolvePrimaryCurrency(paths);

  if (primaryCurrency === undefined) {
    return { kind: "zero-currency" };
  }

  const currencies = Array.from(
    new Set(paths.map((path) => path.currency)),
  ).sort();
  const totals = await Promise.all(
    currencies.map(async (currency) => ({
      currency,
      paidMinor: await sumAdminOrderTotalsForOrganization({
        organizationId: input.organizationId,
        paymentStatus: "paid",
        currency,
        field: "totalMinor",
      }),
    })),
  );

  if (totals.length === 1) {
    return {
      kind: "single",
      currency: totals[0].currency,
      paidMinor: totals[0].paidMinor,
    };
  }

  const primaryTotal = totals.find(
    (total) => total.currency === primaryCurrency,
  );

  return {
    kind: "multi",
    primaryCurrency,
    primaryPaidMinor: primaryTotal?.paidMinor ?? 0,
    otherCurrencies: totals.filter(
      (total) => total.currency !== primaryCurrency,
    ),
  };
}

export async function loadWorkspaceSummary(input: {
  organizationId: string;
  events: WithId<EventDoc>[];
}): Promise<WorkspaceSummary> {
  const { draftCount, publishedCount } = countEventsByStatus(input.events);

  const [registrationsResult, revenueResult] = await Promise.allSettled([
    loadRegistrations({ organizationId: input.organizationId }),
    loadRevenue({ organizationId: input.organizationId }),
  ]);

  return {
    draftCount,
    publishedCount,
    registrations:
      registrationsResult.status === "fulfilled"
        ? registrationsResult.value
        : { loadError: true },
    revenue:
      revenueResult.status === "fulfilled"
        ? revenueResult.value
        : { loadError: true },
    quickActionEvent: input.events[0] ?? null,
  };
}
