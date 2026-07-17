// Shared GET-handler bodies for the 10 report API routes (5 Run + 5 export,
// spec §6/§7, agents/docs/specs/m7-report-templates.md) — each route.ts file
// stays a thin wrapper supplying its own loader + column config, so the
// permission split (D1), cursor parsing, and CSV response shape live in
// exactly one place.
import "server-only";

import { NextResponse } from "next/server";

import { buildReportCsv } from "@/features/reports/csv";
import { resolveReportsRouteScope } from "@/features/reports/server/reports-route-scope";
import type { ReportColumnConfig } from "@/features/reports/templates";
import type { ReportPage, ReportRow } from "@/features/reports/types";

export async function handleReportRunRequest(
  request: Request,
  eventId: string,
  loadPage: (input: {
    eventId: string;
    organizationId: string;
    cursorMs?: number;
  }) => Promise<ReportPage>,
): Promise<Response> {
  // Run: org-membership gate only (spec D1) — no write:events check.
  const scope = await resolveReportsRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const url = new URL(request.url);
  const cursorParam = url.searchParams.get("cursor");
  let cursorMs: number | undefined;
  if (cursorParam !== null) {
    const parsed = Number(cursorParam);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
    cursorMs = parsed;
  }

  const page = await loadPage({
    eventId,
    organizationId: scope.organizationId,
    cursorMs,
  });

  return NextResponse.json(page);
}

export async function handleReportExportRequest(
  eventId: string,
  loadExportRows: (input: {
    eventId: string;
    organizationId: string;
  }) => Promise<ReportRow[]>,
  columns: ReportColumnConfig[],
  filename: string,
): Promise<Response> {
  // Export: write:events gate (spec D1 — the deliberate divergence from
  // Run), the exact precedent already shipped for attendees/export/route.ts.
  const scope = await resolveReportsRouteScope(eventId, {
    requireWriteEvents: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const rows = await loadExportRows({
    eventId,
    organizationId: scope.organizationId,
  });
  const csv = buildReportCsv(columns, rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
