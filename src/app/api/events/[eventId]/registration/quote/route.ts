// Public quote endpoint (M3-T3 step 3 + step-2 promo apply).
// POST /api/events/[eventId]/registration/quote
//
// Server-computed money only — identical inputs and math to the finalize
// path (resolveAdminFeeForOrder + deriveEventPromotionAvailability +
// computeOrderTotals), read-only, zero counter movement (T3 AC-5). The
// client never computes or submits an amount.
//
// Promo secrecy (T2 AC-6/7): a typed promo code validates here; unknown /
// inactive / expired / exhausted / code-less promotions ALL return the same
// generic 400 — no oracle. This route carries the promo-validation rate
// limit (10/min/IP per spec).
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  loadDraftByToken,
  loadPublicRegistrationContext,
  readPublicJsonBody,
} from "@/features/public-registration/server/context";
import {
  computePublicRegistrationQuote,
  GENERIC_PROMO_ERROR,
  resolveActivePromotionByCode,
} from "@/features/public-registration/server/quote";
import { validateTicketSelection } from "@/features/public-registration/server/tickets";
import { checkRequestRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const QuoteRequestSchema = z.object({
  token: z.string().trim().min(1).max(512),
  // Optional overrides for step-2 "Apply" previews (before the selection is
  // persisted); omitted on the summary step, where the draft state is used.
  ticketTypeId: z.string().trim().min(1).max(128).optional(),
  registrationTypeId: z.string().trim().min(1).max(128).nullable().optional(),
  promoCode: z.string().trim().max(64).nullable().optional(),
});

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  // Promo validation shares this route — the strictest public limit applies.
  const rate = checkRequestRateLimit(request, "registration-quote", 10);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many attempts — please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const rawBody = await readPublicJsonBody(request);
  if (!rawBody.ok) {
    return rawBody.reason === "too_large"
      ? NextResponse.json({ error: "Request body too large." }, { status: 413 })
      : NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = QuoteRequestSchema.safeParse(rawBody.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const draft = await loadDraftByToken({ eventId, token: parsed.data.token });
  if (!draft) {
    return NextResponse.json(
      { error: "Registration is not available." },
      { status: 404 },
    );
  }

  const loaded = await loadPublicRegistrationContext({
    eventId,
    pathId: draft.pathId,
  });
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  const { context: ctx } = loaded;

  // Resolve the selection: overrides (step-2 preview) win over draft state
  // (summary). Either way the server re-derives the registration type — the
  // client's value is advisory only (T3 AC-4).
  const ticketTypeId = parsed.data.ticketTypeId ?? draft.ticketTypeId;
  if (!ticketTypeId) {
    return NextResponse.json(
      { error: "Complete the previous steps first.", code: "OUT_OF_ORDER" },
      { status: 409 },
    );
  }
  const requestedRegistrationTypeId =
    parsed.data.registrationTypeId !== undefined
      ? parsed.data.registrationTypeId
      : draft.registrationTypeId;

  const selection = await validateTicketSelection({
    eventId,
    organizationId: ctx.organizationId,
    path: ctx.path,
    ticketTypeId,
    requestedRegistrationTypeId,
  });
  if (!selection.ok) {
    if (selection.code === "CHOICE_REQUIRED") {
      return NextResponse.json(
        { error: "Choose how you are registering.", code: "CHOICE_REQUIRED" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "This selection is no longer available.",
        code: "SELECTION_UNAVAILABLE",
      },
      { status: 400 },
    );
  }

  // Promotion: a typed code (step-2 apply) validates strictly — generic
  // error on ANY failure; otherwise the draft's stored promotionId is used
  // (and silently dropped if no longer available — finalize re-validates).
  let promotionId: string | null = draft.promotionId;
  if (parsed.data.promoCode !== undefined) {
    if (parsed.data.promoCode === null || parsed.data.promoCode === "") {
      promotionId = null;
    } else {
      const promo = await resolveActivePromotionByCode({
        eventId,
        organizationId: ctx.organizationId,
        code: parsed.data.promoCode,
      });
      if (!promo.ok) {
        return NextResponse.json(
          { error: GENERIC_PROMO_ERROR, code: "PROMO_INVALID" },
          { status: 400 },
        );
      }
      promotionId = promo.promotion.id;
    }
  }

  const result = await computePublicRegistrationQuote({
    eventId,
    organizationId: ctx.organizationId,
    ticketTypeId: selection.ticket.id,
    registrationTypeId: selection.registrationTypeId,
    currency: ctx.path.currency,
    promotionId,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: "This selection is no longer available.",
        code: "SELECTION_UNAVAILABLE",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ quote: result.quote });
}
