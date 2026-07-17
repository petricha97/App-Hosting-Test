// API route: GET /api/dashboard/events/[eventId]/reports/abandoned-registrations/export
// CSV export (up to REPORT_EXPORT_ROW_LIMIT rows) — write:events gated
// (spec D1). Email column is masked (D4) — never the raw address, even in
// the file.
import { handleReportExportRequest } from "@/features/reports/server/report-run-handler";
import { loadAbandonedRegistrationsExport } from "@/features/reports/server/load-abandoned-registrations";
import { getReportTemplate } from "@/features/reports/templates";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const TEMPLATE = getReportTemplate("abandoned-registrations")!;

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  return handleReportExportRequest(
    eventId,
    loadAbandonedRegistrationsExport,
    TEMPLATE.columns,
    `${TEMPLATE.slug}-${encodeURIComponent(eventId)}.csv`,
  );
}
