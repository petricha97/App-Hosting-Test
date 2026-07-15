// API route: GET /api/dashboard/events/[eventId]/emails/messages
// Event-wide send log page (spec §5): newest-first, limit 50 + cursor,
// mutually-exclusive status/kind filters (T1 index constraint — the DAL
// throws if both are supplied; this route rejects that combination itself so
// the throw is unreachable, per spec §5 AC-3 "the DAL's typed error is
// unreachable from this screen"). write:events-gated, 404 cross-org.
import { NextResponse } from "next/server";

import { serializeEmailMessage } from "@/features/emails/server/serialize";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import {
  countAdminEmailMessagesForEvent,
  EMAIL_MESSAGE_LIST_LIMIT,
  listAdminEmailMessagesForEvent,
} from "@/lib/db/adminEmailMessage";
import type { EmailMessageStatus } from "@/types/collection";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const VALID_STATUSES: readonly EmailMessageStatus[] = [
  "queued",
  "sent",
  "failed",
];

function parseStatus(
  value: string | null,
): EmailMessageStatus | undefined | null {
  if (value === null) return undefined;
  return (VALID_STATUSES as readonly string[]).includes(value)
    ? (value as EmailMessageStatus)
    : null;
}

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const kindParam = url.searchParams.get("kind");

  if (statusParam && kindParam) {
    return NextResponse.json(
      { error: "Filter by status or by email — not both at once." },
      { status: 400 },
    );
  }

  const status = parseStatus(statusParam);
  if (status === null) {
    return NextResponse.json(
      { error: "Invalid status filter." },
      { status: 400 },
    );
  }

  const cursorParam = url.searchParams.get("cursor");
  let startAfterCreatedAtMs: number | undefined;
  if (cursorParam !== null) {
    const cursorMs = Number(cursorParam);
    if (!Number.isFinite(cursorMs)) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }
    startAfterCreatedAtMs = cursorMs;
  }

  const kind = kindParam ?? undefined;

  const [rows, count] = await Promise.all([
    listAdminEmailMessagesForEvent({
      eventId,
      organizationId: scope.organizationId,
      status,
      kind,
      startAfterCreatedAtMs,
    }),
    countAdminEmailMessagesForEvent({
      eventId,
      organizationId: scope.organizationId,
      status,
      kind,
    }),
  ]);

  const messages = rows.map(serializeEmailMessage);
  const nextCursor =
    rows.length === EMAIL_MESSAGE_LIST_LIMIT
      ? (messages[messages.length - 1]?.createdAtMs ?? null)
      : null;

  return NextResponse.json({ messages, count, nextCursor });
}
