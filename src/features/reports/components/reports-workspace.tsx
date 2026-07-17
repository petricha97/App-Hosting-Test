"use client";

// Reports screen shell (design §0): header + the two summary cards in a
// grid gap-6 lg:grid-cols-2 grid, stacking below ~1024px. Kept as a thin
// Client Component only because the two card-level error panels need an
// onRetry handler (router.refresh()) — no other interactivity on this screen
// (spec §7: zero mutating routes) beyond M7-T3's Schedule button below.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FinanceSummaryCard } from "@/features/reports/components/finance-summary-card";
import { ReportSchedulesDialog } from "@/features/reports/components/report-schedules-dialog";
import { ReportTemplatesSection } from "@/features/reports/components/report-templates-section";
import { TicketTypeBarChartCard } from "@/features/reports/components/ticket-type-bar-chart-card";
import type {
  FinanceCardData,
  TicketTypeRegistrationRow,
} from "@/features/reports/types";
import type { ReportTemplateId } from "@/features/reports/templates";

export interface ReportsWorkspaceProps {
  eventId: string;
  timeZone: string;
  currentUserEmail: string;
  // M7-T3 spec §1 AC-4: an org member without write:events sees the
  // "Schedule" button in a disabled/tooltip state — creating/editing a
  // schedule is write:events-gated, unchanged from every other mutating
  // reports-adjacent action (§7).
  canManageSchedules: boolean;
  // M7-T3 spec §1 AC-3: `?template=<slug>` opens that template's Run panel
  // already expanded — read server-side (page.tsx), passed down here so it
  // reaches report-templates-section.tsx's initial accordion state.
  initialTemplate: ReportTemplateId | null;
  ticketTypeRows: TicketTypeRegistrationRow[];
  ticketTypeLoadError: boolean;
  financeData: FinanceCardData | null;
  financeLoadError: boolean;
}

export function ReportsWorkspace({
  eventId,
  timeZone,
  currentUserEmail,
  canManageSchedules,
  initialTemplate,
  ticketTypeRows,
  ticketTypeLoadError,
  financeData,
  financeLoadError,
}: ReportsWorkspaceProps) {
  const router = useRouter();
  const retry = () => router.refresh();
  const [schedulesOpen, setSchedulesOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Registration and finance snapshots for this event.
          </p>
        </div>
        {canManageSchedules ? (
          <Button variant="outline" onClick={() => setSchedulesOpen(true)}>
            <CalendarClock aria-hidden="true" />
            Schedule
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button variant="outline" disabled>
                  <CalendarClock aria-hidden="true" />
                  Schedule
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              You need edit access to schedule reports
            </TooltipContent>
          </Tooltip>
        )}
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

      <ReportTemplatesSection
        eventId={eventId}
        initialTemplate={initialTemplate}
      />

      {canManageSchedules ? (
        <ReportSchedulesDialog
          open={schedulesOpen}
          onOpenChange={setSchedulesOpen}
          eventId={eventId}
          timeZone={timeZone}
          currentUserEmail={currentUserEmail}
        />
      ) : null}
    </div>
  );
}
