// API route: GET /api/dashboard/events/[eventId]/responses/export
// Per-event CSV export of the responses table (M3-T4 AC-6). write:events
// gated (spec) via the shared registration route scope; honors the same
// ?status= filter as the on-screen table so the file matches the rows.
//
// Formula-injection escaping (cells starting = + - @ get a leading ') and
// RFC-4180 quoting live in the pure builder (src/features/responses/csv.ts).
// Bounded at RESPONSES_EXPORT_LIMIT (1000) rows — one string response, no
// streaming, which is fine at this cap.
import { NextResponse } from "next/server";

import {
  RESPONSES_EXPORT_LIMIT,
  buildResponsesCsv,
  toResponsesCsvRow,
} from "@/features/responses/csv";
import { resolveResponseTicketLabels } from "@/features/responses/server/ticket-labels";
import { parseStatusFilter } from "@/features/responses/status-utils";
import { serializeResponses } from "@/features/responses/utils";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { listAdminFormDataForEvent } from "@/lib/db/adminFormData";

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
  const status = parseStatusFilter(url.searchParams.get("status"));

  const responses = await listAdminFormDataForEvent({
    eventId,
    organizationId: scope.organizationId,
    status,
    limit: RESPONSES_EXPORT_LIMIT,
  });

  const ticketLabels = await resolveResponseTicketLabels(
    responses,
    scope.organizationId,
  );
  const eventNamesById = new Map([[scope.event.id, scope.event.name]]);

  const csv = buildResponsesCsv(
    serializeResponses(responses, eventNamesById, ticketLabels).map(
      toResponsesCsvRow,
    ),
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="responses-${encodeURIComponent(eventId)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
