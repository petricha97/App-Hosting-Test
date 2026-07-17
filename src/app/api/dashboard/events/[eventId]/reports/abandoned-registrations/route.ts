// API route: GET /api/dashboard/events/[eventId]/reports/abandoned-registrations
// "Run" page read (limit 50 + ?cursor= cursor) — org-membership gated only
// (spec D1, agents/docs/specs/m7-report-templates.md). Email column is
// masked (D4) both here and in the export variant.
import { handleReportRunRequest } from "@/features/reports/server/report-run-handler";
import { loadAbandonedRegistrationsPage } from "@/features/reports/server/load-abandoned-registrations";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  return handleReportRunRequest(
    request,
    eventId,
    loadAbandonedRegistrationsPage,
  );
}
