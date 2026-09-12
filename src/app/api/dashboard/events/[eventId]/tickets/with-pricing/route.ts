// API route: POST /api/dashboard/events/[eventId]/tickets/with-pricing
// M9-T1 — the "Create ticket" wizard's single atomic submit target (spec:
// agents/docs/specs/m9-ticket-wizard.md §3). New file, sibling to the
// existing `.../tickets/route.ts` (untouched — Next.js resolves this static
// "with-pricing" segment preferentially over the sibling dynamic
// "[ticketTypeId]" segment, so this route can never be swallowed by
// `[ticketTypeId]/route.ts`). The existing single-entity "Create ticket
// type only" flow keeps using `.../tickets/route.ts` unchanged.
//
// Route-owned validations:
// - ticketWithPricingPayloadSchema: ticket fields identical to
//   ticketTypePayloadSchema (minus registrationTypeIds, which this route
//   ALWAYS derives from `prices` inside the transactional DAL call — never
//   accepted as a separate client-supplied array, see the schema file's
//   header comment); `prices` bounded to MAX_TICKET_REGISTRATION_TYPES
//   rows, no duplicate registrationTypeId (incl. duplicate nulls),
//   basePriceMinor an integer in [0, MAX_PRICE_MINOR].
// - salesEnd >= salesStart (Zod refine on the schema).
// - An OPTIONAL outer registration-type-membership pre-check (spec §3.3
//   step 3) — a latency optimization only, to 400 fast on an obviously-bad
//   id without paying for opening a transaction. It is NOT the authoritative
//   check: a registration type can still be deleted between this call and
//   the transaction's own read, so createAdminTicketTypeWithPricing
//   re-verifies membership itself regardless of this pre-check's outcome.
// - Sales dates -> UTC conversion via the existing, unmodified
//   eventLocalDateToUtcMs/resolveEventTimeZone helpers.
// - Ticket-code uniqueness and the authoritative per-id registration-type
//   membership check both live inside the transactional DAL function
//   (src/lib/db/adminTicketTypeWithPricing.ts) — this route only maps that
//   function's discriminated result onto the HTTP responses in spec §3.4.
import { NextResponse } from "next/server";

import { findUnknownRegistrationTypeIds } from "@/features/registration/server/registration-type-membership";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import {
  eventLocalDateToUtcMs,
  resolveEventTimeZone,
} from "@/features/registration/utils";
import { ticketWithPricingPayloadSchema } from "@/features/ticket-wizard/schemas";
import { createAdminTicketTypeWithPricing } from "@/lib/db/adminTicketTypeWithPricing";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

// Shared 400 body for both the optional pre-check and the transaction's
// authoritative UNKNOWN_REGISTRATION_TYPE result — same message/field as
// the existing /tickets route's registrationTypeIds case, repointed to
// "prices" since that is where the id lives in this payload (spec §3.4).
const UNKNOWN_REGISTRATION_TYPE_RESPONSE = {
  error: "One or more selected registration types do not belong to this event",
  field: "prices",
} as const;

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = ticketWithPricingPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Optional fast-fail pre-check (spec §3.3 step 3) — skipped entirely when
  // prices is empty (AC-8's "free/TBD ticket" case never needs a membership
  // read at all).
  const uniqueNonNullIds = Array.from(
    new Set(
      parsed.data.prices
        .map((price) => price.registrationTypeId)
        .filter((id): id is string => id !== null),
    ),
  );
  if (uniqueNonNullIds.length > 0) {
    const unknownIds = await findUnknownRegistrationTypeIds({
      eventId,
      organizationId: scope.organizationId,
      registrationTypeIds: uniqueNonNullIds,
    });
    if (unknownIds.length > 0) {
      return NextResponse.json(UNKNOWN_REGISTRATION_TYPE_RESPONSE, {
        status: 400,
      });
    }
  }

  const timeZone = resolveEventTimeZone(scope.event.timezone);
  const salesStart = parsed.data.salesStart
    ? new Date(eventLocalDateToUtcMs(parsed.data.salesStart, timeZone, "start"))
    : null;
  const salesEnd = parsed.data.salesEnd
    ? new Date(eventLocalDateToUtcMs(parsed.data.salesEnd, timeZone, "end"))
    : null;

  let result;
  try {
    result = await createAdminTicketTypeWithPricing({
      organizationId: scope.organizationId,
      eventId,
      name: parsed.data.name,
      code: parsed.data.code,
      capacity: parsed.data.capacity,
      salesStart,
      salesEnd,
      isOpen: parsed.data.isOpen,
      prices: parsed.data.prices,
    });
  } catch {
    // Firestore transaction contention / internal failure. Never surface
    // internals to the client — same posture as every other mutating route
    // in this repo.
    return NextResponse.json(
      { error: "Failed to create the ticket" },
      { status: 500 },
    );
  }

  if (!result.ok) {
    if (result.code === "CODE_TAKEN") {
      return NextResponse.json(
        { error: "Code already in use", field: "code" },
        { status: 409 },
      );
    }
    return NextResponse.json(UNKNOWN_REGISTRATION_TYPE_RESPONSE, {
      status: 400,
    });
  }

  return NextResponse.json({
    ticketTypeId: result.ticketTypeId,
    feeIds: result.feeIds,
  });
}
