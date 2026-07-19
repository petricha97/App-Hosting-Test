// API route: GET /api/dashboard/events/[eventId]/reports/registration-overview/export
// CSV export (up to REPORT_EXPORT_ROW_LIMIT rows) — write:events gated
// (spec D1, agents/docs/specs/m7-report-templates.md).
import { handleReportExportRequest } from "@/features/reports/server/report-run-handler";
import { loadRegistrationOverviewExport } from "@/features/reports/server/load-registration-overview";
import { resolveReportsRouteScope } from "@/features/reports/server/reports-route-scope";
import { getReportTemplate } from "@/features/reports/templates";
import { checkRateLimit } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const TEMPLATE = getReportTemplate("registration-overview")!;

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveReportsRouteScope(eventId, {
    requireWriteEvents: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }
  const rate = checkRateLimit(
    `export-report-registration-overview:${scope.organizationId}:${scope.userId}:${eventId}`,
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
    loadRegistrationOverviewExport,
    TEMPLATE.columns,
    `${TEMPLATE.slug}-${encodeURIComponent(eventId)}.csv`,
  );
}
