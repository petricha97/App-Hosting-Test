// API route: GET /api/dashboard/events/[eventId]/responses
// "Load more" page read for the per-event responses table (M3-T4 AC-9:
// limit 50 + submittedAt cursor). Read-level gate: org membership + org-owned
// event — the same audience the server page renders for (no write:events;
// mutations and export stay write-gated on their own routes).
//
// Query params:
//   ?status=  optional status filter (Firestore-side, spec AC-5)
//   ?cursor=  optional UTC ms of the last row's submittedAt (startAfter)
import { NextResponse } from "next/server";

import { resolveResponsesReadScope } from "@/features/responses/server/route-scope";
import { resolveResponseTicketLabels } from "@/features/responses/server/ticket-labels";
import { parseStatusFilter } from "@/features/responses/status-utils";
import { serializeResponses } from "@/features/responses/utils";
import {
  FORM_DATA_LIST_LIMIT,
  listAdminFormDataForEvent,
} from "@/lib/db/adminFormData";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveResponsesReadScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const url = new URL(request.url);
  const status = parseStatusFilter(url.searchParams.get("status"));
  const cursorRaw = url.searchParams.get("cursor");
  const cursorMs = cursorRaw === null ? undefined : Number(cursorRaw);
  if (cursorMs !== undefined && !Number.isFinite(cursorMs)) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  const responses = await listAdminFormDataForEvent({
    eventId,
    organizationId: scope.organizationId,
    status,
    startAfterSubmittedAtMs: cursorMs,
  });

  const ticketLabels = await resolveResponseTicketLabels(
    responses,
    scope.organizationId,
  );
  const eventNamesById = new Map([[scope.event.id, scope.event.name]]);

  return NextResponse.json({
    responses: serializeResponses(responses, eventNamesById, ticketLabels),
    // The client keeps paging while full pages come back.
    hasMore: responses.length === FORM_DATA_LIST_LIMIT,
  });
}
