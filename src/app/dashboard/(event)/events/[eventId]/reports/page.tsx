// Reports screen (M7-T1). Server Component: org-membership gate only (spec
// §7 — a pure read surface, no write:events gate), then two independently
// caught data groups run inside one outer Promise.allSettled (design §3) so
// a Firestore hiccup scoped to one card never blanks the other (spec §5).
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { ReportsLoadError } from "@/features/reports/components/reports-load-error";
import { ReportsWorkspace } from "@/features/reports/components/reports-workspace";
import { loadFinanceSummary } from "@/features/reports/server/load-finance-summary";
import { loadTicketTypeRegistrations } from "@/features/reports/server/load-ticket-type-registrations";
import type {
  FinanceCardData,
  TicketTypeRegistrationRow,
} from "@/features/reports/types";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";

export const metadata: Metadata = {
  title: "Reports | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventReportsPage({ params }: PageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();

  // Whole-page fetch failure (design §0: "getDashboardScope() or the initial
  // event lookup itself throws") — distinct from, and outside, the per-card
  // independent error handling below. notFound() itself must stay OUTSIDE
  // this try/catch (it throws Next's own control-flow error internally).
  let event: Awaited<ReturnType<typeof getAdminEventForOrganization>>;
  try {
    event = await getAdminEventForOrganization(eventId, scope.organizationId);
  } catch {
    return <ReportsLoadError />;
  }

  if (!event) {
    notFound();
  }

  let ticketTypeRows: TicketTypeRegistrationRow[] = [];
  let ticketTypeLoadError = false;
  // null = zero-currency empty state (design §3) — also the safe default on
  // a caught failure, since financeLoadError renders its own error panel
  // before this value is ever read.
  let financeData: FinanceCardData | null = null;
  let financeLoadError = false;

  const [ticketTypeResult, financeResult] = await Promise.allSettled([
    loadTicketTypeRegistrations({
      eventId,
      organizationId: scope.organizationId,
    }),
    loadFinanceSummary({ eventId, organizationId: scope.organizationId }),
  ]);

  if (ticketTypeResult.status === "fulfilled") {
    ticketTypeRows = ticketTypeResult.value;
  } else {
    ticketTypeLoadError = true;
  }

  if (financeResult.status === "fulfilled") {
    financeData = financeResult.value;
  } else {
    financeLoadError = true;
  }

  return (
    <ReportsWorkspace
      eventId={eventId}
      ticketTypeRows={ticketTypeRows}
      ticketTypeLoadError={ticketTypeLoadError}
      financeData={financeData}
      financeLoadError={financeLoadError}
    />
  );
}
