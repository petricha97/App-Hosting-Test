// API route: GET /api/dashboard/events/[eventId]/reports/order-transactions
// "Run" page read (limit 50 + ?cursor= cursor) — org-membership gated only
// (spec D1, agents/docs/specs/m7-report-templates.md).
import { handleReportRunRequest } from "@/features/reports/server/report-run-handler";
import { loadOrderTransactionsPage } from "@/features/reports/server/load-order-transactions";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  return handleReportRunRequest(request, eventId, loadOrderTransactionsPage);
}
