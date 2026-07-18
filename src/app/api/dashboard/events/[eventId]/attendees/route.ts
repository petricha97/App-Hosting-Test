// API route: GET /api/dashboard/events/[eventId]/attendees
// "Load more" page read for the merged attendee roster (M5-T2: limit 50 +
// per-source cursors). Originally write:events-gated per spec T2 AC-9; M8-T1
// (spec D6) reclassifies this GET to view-tier ({ requireWriteEvents: false })
// — the SSR page it paginates (attendees/page.tsx, via getDashboardScope())
// has always rendered the first page to any org member permission-check-free,
// so a Viewer would otherwise see rows 1-50 fine and then 403 on "load more".
// This is the ONE route this ticket's enforcement sweep reclassifies — every
// other resolveRegistrationRouteScope() caller is unchanged (still defaults
// to write:events on every method).
//
// Query params:
//   ?status=          accepted | pending (anything else = merged view)
//   ?attendeeCursor=  UTC ms of the last attendee row's createdAt
//   ?pendingCursor=   UTC ms of the last RAW FormData page item's submittedAt
import { NextResponse } from "next/server";

import { loadRosterPage } from "@/features/attendees/server/load-roster";
import { parseRosterStatusFilter } from "@/features/attendees/roster";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

function parseCursor(value: string | null): number | undefined | null {
  if (value === null) return undefined;
  const ms = Number(value);
  // null = invalid (route responds 400).
  return Number.isFinite(ms) ? ms : null;
}

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId, {
    requireWriteEvents: false,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const url = new URL(request.url);
  const status = parseRosterStatusFilter(url.searchParams.get("status"));
  const attendeeCursorMs = parseCursor(url.searchParams.get("attendeeCursor"));
  const pendingCursorMs = parseCursor(url.searchParams.get("pendingCursor"));
  if (attendeeCursorMs === null || pendingCursorMs === null) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  const page = await loadRosterPage({
    eventId,
    organizationId: scope.organizationId,
    status,
    attendeeCursorMs,
    pendingCursorMs,
  });

  return NextResponse.json(page);
}
