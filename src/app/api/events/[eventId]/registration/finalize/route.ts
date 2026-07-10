// Public finalize endpoint (M3-T3): draft → Order → FormData → draft delete.
// POST /api/events/[eventId]/registration/finalize
//
// CONTRACTUAL ORDER (spec data-model "Crash-recovery / idempotency flow"):
//   1. placeOrder(idempotencyKey = "reg:" + draftId + ":" + attempt)
//      — the M2 finalize transaction owns counters + idempotent replay;
//   2. createAdminFormDataForDraft — doc id derived from the draftId
//      (create-if-absent: a crash between 1 and 2 heals on retry);
//   3. deleteAdminRegistrationDraft — ONLY after Order AND FormData exist;
//   attempt++ happens ONLY on PAYMENT_FAILED (fresh idempotency key for the
//   declined-card retry; double-clicks keep colliding on the current key).
//
// paymentMethod and currency come from the PATH DOC — the request body is
// { token } and nothing else; any client-supplied method/currency/amount is
// stripped by the schema (T3 AC-6). Card data never reaches this server
// (the provider is simulated).
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  loadDraftByToken,
  loadPublicRegistrationContext,
  readPublicJsonBody,
} from "@/features/public-registration/server/context";
import { GENERIC_PROMO_ERROR } from "@/features/public-registration/server/quote";
import { createAdminFormDataForDraft } from "@/lib/db/adminFormData";
import {
  deleteAdminRegistrationDraft,
  incrementAdminRegistrationDraftAttempt,
} from "@/lib/db/adminRegistrationDraft";
import { formDataIdFromDraftId } from "@/lib/db/formDataId";
import { getAdminTicketTypeForEvent } from "@/lib/db/adminTicketType";
import { placeOrder, type PlaceOrderErrorCode } from "@/lib/orders/place-order";
import { SimulatedPaymentProvider } from "@/lib/payments/simulated-payment-provider";
import { checkRequestRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

// Unknown keys (paymentMethod, currency, amounts, card fields, ...) are
// STRIPPED — the token is the entire client contribution.
const FinalizeRequestSchema = z.object({
  token: z.string().trim().min(1).max(512),
});

// Typed-error surface mapping (spec T3 error table; raw M2 codes are mapped
// to stable public codes + friendly copy — never echoed verbatim to users).
function mapFinalizeError(code: PlaceOrderErrorCode, message: string) {
  switch (code) {
    case "SOLD_OUT":
    case "TYPE_FULL":
      // 409 + a refresh signal: the client returns to step 2 and refetches
      // availability (the losing racer's draft stays intact — T3 AC-9).
      return NextResponse.json(
        {
          error: "That ticket just sold out.",
          code,
          refresh: "tickets" as const,
        },
        { status: 409 },
      );
    case "PRICE_CHANGED":
      return NextResponse.json(
        { error: "Prices were updated — please review.", code },
        { status: 409 },
      );
    case "PROMO_EXPIRED":
    case "PROMO_EXHAUSTED":
      // Collapsed to the one generic promo message (no oracle).
      return NextResponse.json(
        { error: GENERIC_PROMO_ERROR, code: "PROMO_INVALID" },
        { status: 409 },
      );
    case "PAYMENT_FAILED":
      return NextResponse.json(
        // The simulated provider's reason is safe display copy.
        { error: message, code },
        { status: 402 },
      );
    default:
      // NO_FEE / INVALID_REFERENCE / INVALID_METHOD → the selection can no
      // longer be fulfilled as configured.
      return NextResponse.json(
        {
          error: "This selection is no longer available.",
          code: "SELECTION_UNAVAILABLE",
        },
        { status: 409 },
      );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  const rate = checkRequestRateLimit(request, "registration-finalize", 10);
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

  const parsed = FinalizeRequestSchema.safeParse(rawBody.body);
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

  // Out-of-order finalize (token holder skipping step 2) — reject before any
  // money movement (T3 AC-2).
  if (!draft.ticketTypeId || !draft.registrationTypeId) {
    return NextResponse.json(
      { error: "Complete the previous steps first.", code: "OUT_OF_ORDER" },
      { status: 409 },
    );
  }

  // The FormData id is deterministic from the draft — known BEFORE the order
  // exists, so the Order doc links to its submission from birth and retries
  // land on the same doc.
  const formDataId = formDataIdFromDraftId({
    organizationId: ctx.organizationId,
    eventId,
    draftId: draft.id,
  });

  // --- 1. placeOrder — method/currency from the PATH, never the client. ---
  const result = await placeOrder({
    organizationId: ctx.organizationId,
    eventId,
    idempotencyKey: `reg:${draft.id}:${draft.attempt}`,
    submissionId: formDataId,
    ticketTypeId: draft.ticketTypeId,
    registrationTypeId: draft.registrationTypeId,
    promotionId: draft.promotionId,
    currency: ctx.path.currency,
    paymentMethod: ctx.path.paymentMethod,
    provider: new SimulatedPaymentProvider(),
  });

  if (!result.ok) {
    if (result.code === "PAYMENT_FAILED") {
      // Fresh idempotency key for the retry — ONLY on payment failure.
      await incrementAdminRegistrationDraftAttempt(draft.id);
    }
    return mapFinalizeError(result.code, result.message);
  }

  // --- 2. FormData (create-if-absent at the deterministic id). ---
  // Denormalized fields derive from the AUTHORITATIVE ORDER, never the draft:
  // a crash-replay window exists where the draft can be PATCHed to a
  // different ticket after the order was placed — the replayed order (same
  // idempotency key) still carries the ticket the money actually moved for,
  // so the FormData must record THAT ticket (review S2).
  const ticket = await getAdminTicketTypeForEvent({
    ticketTypeId: result.order.ticketTypeId,
    eventId,
    organizationId: ctx.organizationId,
  });
  const ticketLabel = ticket?.name ?? null;

  const formDataResult = await createAdminFormDataForDraft({
    organizationId: ctx.organizationId,
    eventId,
    draftId: draft.id,
    formId: draft.formId,
    // Display-only commerce entries join the step-1 answers (spec T2
    // backward-compat note): human-readable ticket label + applied code from
    // the order's frozen snapshot — never from client input.
    submission: {
      ...draft.stepAnswers,
      ...(ticketLabel ? { ticket: ticketLabel } : {}),
      ...(result.order.snapshot.promoCode
        ? { promo_code: result.order.snapshot.promoCode }
        : {}),
    },
    orderId: result.orderId,
    pathId: ctx.path.id,
    ticketLabel,
  });

  // --- 3. Draft delete — only now that Order AND FormData both exist. ---
  await deleteAdminRegistrationDraft(draft.id);

  return NextResponse.json({
    registrationRef: formDataResult.formDataId,
    orderRef: result.orderId,
    paymentStatus: result.order.paymentStatus,
    amounts: result.order.amounts,
    currency: result.order.currency,
  });
}
