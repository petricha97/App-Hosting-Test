// API route: GET /api/dashboard/events/[eventId]/reports/checkin-history
// "Run" page read (limit 50 + ?cursor= cursor) — org-membership gated only
// (spec D1, agents/docs/specs/m7-report-templates.md).
import { handleReportRunRequest } from "@/features/reports/server/report-run-handler";
import { loadCheckinHistoryPage } from "@/features/reports/server/load-checkin-history";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  return handleReportRunRequest(request, eventId, loadCheckinHistoryPage);
}
