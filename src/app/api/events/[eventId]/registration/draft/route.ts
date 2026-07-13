// Public (unauthenticated) draft endpoints for the multi-step registration
// flow — M3-T3 draft persistence + M3-T5 abandoned tracking.
//
//   POST  — completes step 1: creates the RegistrationDraft and returns the
//           signed draft token EXACTLY ONCE (response body only; the client
//           keeps it in sessionStorage — never in URLs).
//   PATCH — steps 2–4: token-gated partial updates. Server re-validates the
//           ticket selection (eligibility × open × priced) and stamps
//           lastStepReached; out-of-order steps are rejected (T3 AC-2).
//   GET   — resume: token via the "x-draft-token" header re-hydrates the
//           stepper at lastStepReached.
//
// Rigor instead of auth (spec Shared decisions): strict Zod (unknown keys
// stripped, length caps), 32KB body cap, best-effort per-IP rate limiting
// (in-memory, documented in src/lib/rate-limit.ts), and the signed draft
// token as the sole capability — forged/mismatched tokens 404.
import { NextResponse } from "next/server";
import { z } from "zod";

import { buildFormSubmissionSchema, getNonCommerceFields } from "@/features/form/schema";
import {
  loadDraftByToken,
  loadPublicRegistrationContext,
  readPublicJsonBody,
} from "@/features/public-registration/server/context";
import { validateTicketSelection } from "@/features/public-registration/server/tickets";
import {
  GENERIC_PROMO_ERROR,
  resolveActivePromotionByCode,
} from "@/features/public-registration/server/quote";
import {
  createAdminRegistrationDraft,
  updateAdminRegistrationDraftStep,
} from "@/lib/db/adminRegistrationDraft";
import {
  generateDraftId,
  hashDraftToken,
  mintDraftToken,
} from "@/lib/draft-token";
import { checkRequestRateLimit } from "@/lib/rate-limit";
import type { RegistrationDraftStep } from "@/types/collection";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const NOT_FOUND = NextResponse.json(
  { error: "Registration is not available." },
  { status: 404 },
);

function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many attempts — please wait a moment." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

function bodyGuardResponse(reason: "too_large" | "invalid") {
  return reason === "too_large"
    ? NextResponse.json({ error: "Request body too large." }, { status: 413 })
    : NextResponse.json({ error: "Invalid request body." }, { status: 400 });
}

// ---------------------------------------------------------------------------
// POST — create draft after step 1
// ---------------------------------------------------------------------------

const CreateDraftRequestSchema = z.object({
  pathId: z.string().trim().min(1).max(128),
  // Loose outer shape; the real validation is the form-derived schema below.
  submission: z.record(z.string().max(200), z.string().max(5000)),
});

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  const rate = checkRequestRateLimit(request, "registration-draft-create", 30);
  if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds);

  const rawBody = await readPublicJsonBody(request);
  if (!rawBody.ok) return bodyGuardResponse(rawBody.reason);

  const parsed = CreateDraftRequestSchema.safeParse(rawBody.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const loaded = await loadPublicRegistrationContext({
    eventId,
    pathId: parsed.data.pathId,
  });
  if (!loaded.ok) return NOT_FOUND;
  const { context: ctx } = loaded;

  // Step-1 answers validate against the form's QUESTION fields only —
  // commerce values travel through the draft selections, never here.
  const questionFields = getNonCommerceFields(ctx.form.fields);
  const submissionSchema = buildFormSubmissionSchema(questionFields);
  const submission = submissionSchema.safeParse(parsed.data.submission);
  if (!submission.success) {
    return NextResponse.json(
      { error: submission.error.flatten() },
      { status: 400 },
    );
  }

  // Mint id + token BEFORE the write: the doc stores only the token's hash.
  const draftId = generateDraftId();
  const draftToken = mintDraftToken({ draftId, eventId });

  await createAdminRegistrationDraft({
    draftId,
    organizationId: ctx.organizationId,
    eventId,
    pathId: ctx.path.id,
    formId: ctx.form.id,
    draftTokenHash: hashDraftToken(draftToken),
    stepAnswers: submission.data,
    // Denorms for the abandoned surface (T5 AC-2) — mandatory field keys.
    firstName: submission.data.first_name ?? "",
    lastName: submission.data.last_name ?? "",
    email: submission.data.email ?? "",
  });

  // The raw token is returned exactly once, in the response body.
  return NextResponse.json({ draftId, draftToken });
}

// ---------------------------------------------------------------------------
// PATCH — token-gated step updates (steps 2–4)
// ---------------------------------------------------------------------------

const STEP_ORDER: RegistrationDraftStep[] = [
  "personal_info",
  "ticket_options",
  "summary",
  "payment",
];

function stepIndex(step: RegistrationDraftStep): number {
  return STEP_ORDER.indexOf(step);
}

const PatchDraftRequestSchema = z.discriminatedUnion("step", [
  // Step-1 re-edit (summary "Edit" → back to Personal Information): answers
  // re-validate against the published form exactly like the create.
  z.object({
    token: z.string().trim().min(1).max(512),
    step: z.literal("personal_info"),
    submission: z.record(z.string().max(200), z.string().max(5000)),
  }),
  z.object({
    token: z.string().trim().min(1).max(512),
    step: z.literal("ticket_options"),
    ticketTypeId: z.string().trim().min(1).max(128),
    registrationTypeId: z.string().trim().min(1).max(128).nullable().default(null),
    // Free-text promo code; resolved server-side to a promotionId — the TEXT
    // is never persisted (T5 AC-4). null clears an applied code.
    promoCode: z.string().trim().max(64).nullable().default(null),
  }),
  z.object({
    token: z.string().trim().min(1).max(512),
    step: z.literal("summary"),
  }),
  z.object({
    token: z.string().trim().min(1).max(512),
    step: z.literal("payment"),
  }),
]);

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  const rate = checkRequestRateLimit(request, "registration-draft-update", 30);
  if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds);

  const rawBody = await readPublicJsonBody(request);
  if (!rawBody.ok) return bodyGuardResponse(rawBody.reason);

  const parsed = PatchDraftRequestSchema.safeParse(rawBody.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const draft = await loadDraftByToken({ eventId, token: parsed.data.token });
  if (!draft) return NOT_FOUND;

  const loaded = await loadPublicRegistrationContext({
    eventId,
    pathId: draft.pathId,
  });
  if (!loaded.ok) return NOT_FOUND;
  const { context: ctx } = loaded;

  // lastStepReached only ever moves FORWARD (revisiting step 2 after the
  // summary never regresses the abandoned-surface marker).
  const advanceTo = (step: RegistrationDraftStep): RegistrationDraftStep =>
    stepIndex(step) > stepIndex(draft.lastStepReached)
      ? step
      : draft.lastStepReached;

  if (parsed.data.step === "personal_info") {
    const questionFields = getNonCommerceFields(ctx.form.fields);
    const submissionSchema = buildFormSubmissionSchema(questionFields);
    const submission = submissionSchema.safeParse(parsed.data.submission);
    if (!submission.success) {
      return NextResponse.json(
        { error: submission.error.flatten() },
        { status: 400 },
      );
    }

    await updateAdminRegistrationDraftStep(draft.id, {
      // Re-editing step 1 never regresses lastStepReached.
      stepAnswers: submission.data,
      firstName: submission.data.first_name ?? "",
      lastName: submission.data.last_name ?? "",
      email: submission.data.email ?? "",
    });

    return NextResponse.json({ ok: true });
  }

  if (parsed.data.step === "ticket_options") {
    const selection = await validateTicketSelection({
      eventId,
      organizationId: ctx.organizationId,
      path: ctx.path,
      ticketTypeId: parsed.data.ticketTypeId,
      requestedRegistrationTypeId: parsed.data.registrationTypeId,
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
    if (selection.soldOut) {
      return NextResponse.json(
        { error: "That ticket just sold out.", code: "SOLD_OUT" },
        { status: 409 },
      );
    }

    // Promo resolution: id only is stored; ALL failure causes share the one
    // generic message (T2 AC-6).
    let promotionId: string | null = null;
    if (parsed.data.promoCode) {
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

    await updateAdminRegistrationDraftStep(draft.id, {
      lastStepReached: advanceTo("ticket_options"),
      ticketTypeId: selection.ticket.id,
      registrationTypeId: selection.registrationTypeId,
      promotionId,
    });

    return NextResponse.json({
      ok: true,
      promoApplied: promotionId !== null,
    });
  }

  // summary / payment markers: reject out-of-order jumps — a step-3/4 stamp
  // requires a completed ticket selection, and payment additionally requires
  // a path that HAS a payment step (T3 AC-2: tampering cannot skip
  // validation or payment).
  if (!draft.ticketTypeId || !draft.registrationTypeId) {
    return NextResponse.json(
      { error: "Complete the previous steps first.", code: "OUT_OF_ORDER" },
      { status: 409 },
    );
  }
  if (parsed.data.step === "payment") {
    const skipsPayment =
      ctx.path.paymentMethod === "comp" || ctx.path.paymentMethod === "none";
    if (skipsPayment || stepIndex(draft.lastStepReached) < stepIndex("summary")) {
      return NextResponse.json(
        { error: "Complete the previous steps first.", code: "OUT_OF_ORDER" },
        { status: 409 },
      );
    }
  }

  await updateAdminRegistrationDraftStep(draft.id, {
    lastStepReached: advanceTo(parsed.data.step),
  });

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// GET — resume by token (header transport only; tokens never ride URLs)
// ---------------------------------------------------------------------------

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  const rate = checkRequestRateLimit(request, "registration-draft-read", 30);
  if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds);

  const token = request.headers.get("x-draft-token")?.trim() ?? "";
  if (!token || token.length > 512) return NOT_FOUND;

  const draft = await loadDraftByToken({ eventId, token });
  if (!draft) return NOT_FOUND;

  // Resume payload: what the stepper needs to re-hydrate — never the token
  // hash, org internals, or the attempt counter.
  return NextResponse.json({
    draftId: draft.id,
    pathId: draft.pathId,
    lastStepReached: draft.lastStepReached,
    stepAnswers: draft.stepAnswers,
    ticketTypeId: draft.ticketTypeId,
    registrationTypeId: draft.registrationTypeId,
    promoApplied: draft.promotionId !== null,
  });
}
