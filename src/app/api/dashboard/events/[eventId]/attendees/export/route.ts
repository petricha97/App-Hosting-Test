// API route: GET /api/dashboard/events/[eventId]/attendees/export
// Per-event CSV export of the merged attendee roster (M5-T2 AC-8).
// write:events-gated; honors the same ?status= filter as the on-screen table
// so the file matches the rows. Escaping (formula-injection guard +
// RFC-4180 quoting) lives in the shared pure builder — same rules as the
// M3-T4 responses export (spec: "same escaping rules as M3-T4 AC-6").
// Bounded at ATTENDEES_EXPORT_LIMIT (1000) rows per source.
import { NextResponse } from "next/server";

import {
  ATTENDEES_EXPORT_LIMIT,
  buildAttendeesCsv,
} from "@/features/attendees/csv";
import { parseRosterStatusFilter } from "@/features/attendees/roster";
import { loadRosterPage } from "@/features/attendees/server/load-roster";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const url = new URL(request.url);
  const status = parseRosterStatusFilter(url.searchParams.get("status"));

  const page = await loadRosterPage({
    eventId,
    organizationId: scope.organizationId,
    status,
    limit: ATTENDEES_EXPORT_LIMIT,
  });

  const csv = buildAttendeesCsv(page.rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendees-${encodeURIComponent(eventId)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
