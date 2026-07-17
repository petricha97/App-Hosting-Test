// API route: GET /api/dashboard/events/[eventId]/reports/email-overview
// "Run" page read (limit 50 + ?cursor= cursor) — org-membership gated only
// (spec D1, agents/docs/specs/m7-report-templates.md).
import { handleReportRunRequest } from "@/features/reports/server/report-run-handler";
import { loadEmailOverviewPage } from "@/features/reports/server/load-email-overview";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  return handleReportRunRequest(request, eventId, loadEmailOverviewPage);
}
