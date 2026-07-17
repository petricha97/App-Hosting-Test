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
import { isReportTemplateId } from "@/features/reports/templates";
import type {
  FinanceCardData,
  TicketTypeRegistrationRow,
} from "@/features/reports/types";
import { resolveEventTimeZone } from "@/features/registration/utils";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";

export const metadata: Metadata = {
  title: "Reports | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
  // M7-T3 spec §1 AC-3: `?template=<slug>` opens that template's Run panel
  // already expanded (the emailed schedule-notification's own deep link) —
  // same server-side searchParams-read convention as emails/page.tsx's
  // `?tab=`.
  searchParams?: Promise<{ template?: string | string[] }>;
}

export default async function EventReportsPage({
  params,
  searchParams,
}: PageProps) {
  const [{ eventId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ template?: string | string[] }>({}),
  ]);
  const templateParam = resolvedSearchParams?.template;
  const templateValue = Array.isArray(templateParam)
    ? templateParam[0]
    : templateParam;
  const initialTemplate =
    typeof templateValue === "string" && isReportTemplateId(templateValue)
      ? templateValue
      : null;

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
      timeZone={resolveEventTimeZone(event.timezone)}
      currentUserEmail={scope.userDoc.email}
      canManageSchedules={scope.userDoc.permissions.includes("write:events")}
      initialTemplate={initialTemplate}
      ticketTypeRows={ticketTypeRows}
      ticketTypeLoadError={ticketTypeLoadError}
      financeData={financeData}
      financeLoadError={financeLoadError}
    />
  );
}
