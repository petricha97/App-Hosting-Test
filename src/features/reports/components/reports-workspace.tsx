"use client";

// Reports screen shell (design §0): header + the two summary cards in a
// grid gap-6 lg:grid-cols-2 grid, stacking below ~1024px. Kept as a thin
// Client Component only because the two card-level error panels need an
// onRetry handler (router.refresh()) — no other interactivity on this screen
// (spec §7: zero mutating routes).
import { useRouter } from "next/navigation";

import { FinanceSummaryCard } from "@/features/reports/components/finance-summary-card";
import { ReportTemplatesSection } from "@/features/reports/components/report-templates-section";
import { TicketTypeBarChartCard } from "@/features/reports/components/ticket-type-bar-chart-card";
import type {
  FinanceCardData,
  TicketTypeRegistrationRow,
} from "@/features/reports/types";

export interface ReportsWorkspaceProps {
  eventId: string;
  ticketTypeRows: TicketTypeRegistrationRow[];
  ticketTypeLoadError: boolean;
  financeData: FinanceCardData | null;
  financeLoadError: boolean;
}

export function ReportsWorkspace({
  eventId,
  ticketTypeRows,
  ticketTypeLoadError,
  financeData,
  financeLoadError,
}: ReportsWorkspaceProps) {
  const router = useRouter();
  const retry = () => router.refresh();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Registration and finance snapshots for this event.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TicketTypeBarChartCard
          eventId={eventId}
          rows={ticketTypeRows}
          loadError={ticketTypeLoadError}
          onRetry={retry}
        />
        <FinanceSummaryCard
          eventId={eventId}
          data={financeData}
          loadError={financeLoadError}
          onRetry={retry}
        />
      </div>

      <ReportTemplatesSection eventId={eventId} />
    </div>
  );
}
