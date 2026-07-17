// API route: GET /api/dashboard/events/[eventId]/reports/checkin-history/export
// CSV export (up to REPORT_EXPORT_ROW_LIMIT rows) — write:events gated
// (spec D1, agents/docs/specs/m7-report-templates.md).
import { handleReportExportRequest } from "@/features/reports/server/report-run-handler";
import { loadCheckinHistoryExport } from "@/features/reports/server/load-checkin-history";
import { getReportTemplate } from "@/features/reports/templates";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const TEMPLATE = getReportTemplate("checkin-history")!;

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  return handleReportExportRequest(
    eventId,
    loadCheckinHistoryExport,
    TEMPLATE.columns,
    `${TEMPLATE.slug}-${encodeURIComponent(eventId)}.csv`,
  );
}
