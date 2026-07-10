// API route: GET /api/dashboard/responses/export
// Workspace-level (all events in the active org) CSV export of the responses
// table (M3-T4 AC-6). write:events gated via the org-level scope; honors the
// same ?status= and ?event= filters as the on-screen workspace table.
//
// A foreign/unknown ?event= id resolves to 404 (never leaks whether the
// event exists in another org). Escaping and row shape live in the pure
// builder (src/features/responses/csv.ts); bounded at 1000 rows.
import { NextResponse } from "next/server";

import {
  RESPONSES_EXPORT_LIMIT,
  buildResponsesCsv,
  toResponsesCsvRow,
} from "@/features/responses/csv";
import { resolveResponsesOrgWriteScope } from "@/features/responses/server/route-scope";
import { resolveResponseTicketLabels } from "@/features/responses/server/ticket-labels";
import { parseStatusFilter } from "@/features/responses/status-utils";
import { serializeResponses } from "@/features/responses/utils";
import {
  getAdminEventForOrganization,
  getAdminEventsForOrganization,
} from "@/lib/db/adminEvent";
import {
  listAdminFormDataForEvent,
  listAdminFormDataForOrganization,
} from "@/lib/db/adminFormData";

export async function GET(request: Request) {
  const scope = await resolveResponsesOrgWriteScope();
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const url = new URL(request.url);
  const status = parseStatusFilter(url.searchParams.get("status"));
  const eventFilter = url.searchParams.get("event");

  if (eventFilter) {
    const event = await getAdminEventForOrganization(
      eventFilter,
      scope.organizationId,
    );
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
  }

  const responses = eventFilter
    ? await listAdminFormDataForEvent({
        eventId: eventFilter,
        organizationId: scope.organizationId,
        status,
        limit: RESPONSES_EXPORT_LIMIT,
      })
    : await listAdminFormDataForOrganization({
        organizationId: scope.organizationId,
        status,
        limit: RESPONSES_EXPORT_LIMIT,
      });

  const [ticketLabels, events] = await Promise.all([
    resolveResponseTicketLabels(responses, scope.organizationId),
    getAdminEventsForOrganization(scope.organizationId),
  ]);
  const eventNamesById = new Map(
    events.map((event) => [event.id, event.name]),
  );

  const csv = buildResponsesCsv(
    serializeResponses(responses, eventNamesById, ticketLabels).map(
      toResponsesCsvRow,
    ),
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="responses.csv"',
      "Cache-Control": "no-store",
    },
  });
}
