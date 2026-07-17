// API route: GET /api/dashboard/events/[eventId]/reports/registration-overview/export
// CSV export (up to REPORT_EXPORT_ROW_LIMIT rows) — write:events gated
// (spec D1, agents/docs/specs/m7-report-templates.md).
import { handleReportExportRequest } from "@/features/reports/server/report-run-handler";
import { loadRegistrationOverviewExport } from "@/features/reports/server/load-registration-overview";
import { getReportTemplate } from "@/features/reports/templates";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const TEMPLATE = getReportTemplate("registration-overview")!;

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  return handleReportExportRequest(
    eventId,
    loadRegistrationOverviewExport,
    TEMPLATE.columns,
    `${TEMPLATE.slug}-${encodeURIComponent(eventId)}.csv`,
  );
}
