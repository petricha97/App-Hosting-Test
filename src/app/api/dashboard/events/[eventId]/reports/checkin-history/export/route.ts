// API route: GET /api/dashboard/events/[eventId]/reports/checkin-history/export
// CSV export (up to REPORT_EXPORT_ROW_LIMIT rows) — write:events gated
// (spec D1, agents/docs/specs/m7-report-templates.md).
import { handleReportExportRequest } from "@/features/reports/server/report-run-handler";
import { loadCheckinHistoryExport } from "@/features/reports/server/load-checkin-history";
import { resolveReportsRouteScope } from "@/features/reports/server/reports-route-scope";
import { getReportTemplate } from "@/features/reports/templates";
import { checkRateLimit } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const TEMPLATE = getReportTemplate("checkin-history")!;

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveReportsRouteScope(eventId, {
    requireWriteEvents: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }
  const rate = checkRateLimit(
    `export-report-checkin-history:${scope.organizationId}:${scope.userId}:${eventId}`,
    { limit: 10 },
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many exports — wait a moment." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  return handleReportExportRequest(
    eventId,
    scope.organizationId,
    loadCheckinHistoryExport,
    TEMPLATE.columns,
    `${TEMPLATE.slug}-${encodeURIComponent(eventId)}.csv`,
  );
}
