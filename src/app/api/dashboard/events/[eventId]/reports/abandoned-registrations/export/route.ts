// API route: GET /api/dashboard/events/[eventId]/reports/abandoned-registrations/export
// CSV export (up to REPORT_EXPORT_ROW_LIMIT rows) — write:events gated
// (spec D1). Email column is masked (D4) — never the raw address, even in
// the file.
import { handleReportExportRequest } from "@/features/reports/server/report-run-handler";
import { loadAbandonedRegistrationsExport } from "@/features/reports/server/load-abandoned-registrations";
import { resolveReportsRouteScope } from "@/features/reports/server/reports-route-scope";
import { getReportTemplate } from "@/features/reports/templates";
import { checkRateLimit } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const TEMPLATE = getReportTemplate("abandoned-registrations")!;

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveReportsRouteScope(eventId, {
    requireWriteEvents: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }
  const rate = checkRateLimit(
    `export-report-abandoned-registrations:${scope.organizationId}:${scope.userId}:${eventId}`,
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
    loadAbandonedRegistrationsExport,
    TEMPLATE.columns,
    `${TEMPLATE.slug}-${encodeURIComponent(eventId)}.csv`,
  );
}
