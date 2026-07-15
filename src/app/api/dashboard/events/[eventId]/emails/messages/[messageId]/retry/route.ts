// API route: POST
// /api/dashboard/events/[eventId]/emails/messages/[messageId]/retry
// Spec §5: failed rows only; NOT_RETRYABLE (sent/queued) -> 409, NOT_FOUND
// (missing OR cross-org) -> 404 — a stale UI retry of a since-sent row is a
// calm typed error, not a duplicate send. write:events-gated.
import { NextResponse } from "next/server";

import { serializeEmailMessage } from "@/features/emails/server/serialize";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { getAdminEmailMessageForEvent } from "@/lib/db/adminEmailMessage";
import { retryEmailMessage } from "@/lib/email/send-service";
import { checkRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string; messageId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { eventId, messageId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const rate = checkRateLimit(`emails-retry:${scope.userId}`, { limit: 30 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many retries — wait a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const result = await retryEmailMessage({
    messageId,
    eventId,
    organizationId: scope.organizationId,
  });

  if (!result.ok && result.outcome === "not-found") {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }
  if (!result.ok && result.outcome === "not-retryable") {
    return NextResponse.json(
      { error: "This email was already sent." },
      { status: 409 },
    );
  }

  // "sent" or "failed" (a re-attempt that failed again) both land here — the
  // row itself carries the true status; re-fetch the frozen doc for the
  // client rather than trusting either result's partial shape.
  const message = await getAdminEmailMessageForEvent({
    messageId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!message) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  return NextResponse.json({ message: serializeEmailMessage(message) });
}
