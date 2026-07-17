// API route: GET /api/dashboard/events/[eventId]/reports/order-transactions/export
// CSV export (up to REPORT_EXPORT_ROW_LIMIT rows) — write:events gated
// (spec D1, agents/docs/specs/m7-report-templates.md).
import { handleReportExportRequest } from "@/features/reports/server/report-run-handler";
import { loadOrderTransactionsExport } from "@/features/reports/server/load-order-transactions";
import { getReportTemplate } from "@/features/reports/templates";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const TEMPLATE = getReportTemplate("order-transactions")!;

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  return handleReportExportRequest(
    eventId,
    loadOrderTransactionsExport,
    TEMPLATE.columns,
    `${TEMPLATE.slug}-${encodeURIComponent(eventId)}.csv`,
  );
}
