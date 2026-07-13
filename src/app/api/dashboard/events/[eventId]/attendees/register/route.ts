// API route: POST /api/dashboard/events/[eventId]/attendees/register
// Manual (admin-side) registration — M5-T2, minimal scope.
//
// Runs the SAME pipeline as the public finalize (one code path = one set of
// counters/pricing/idempotency guarantees; no parallel "admin insert" that
// skips capacity or fees):
//   1. placeOrder(idempotencyKey = "manual:" + requestId) — requestId is a
//      client-minted id generated once per dialog open, so double-submits
//      and retries collapse onto one order (T2 AC-6);
//   2. createAdminFormDataForDraft with the SYNTHETIC draft id
//      "manual:" + requestId — the FormData doc id is deterministic from it,
//      so the create is a crash-recoverable create-if-absent and the QR
//      token hash is stamped exactly like a public finalize;
//   3. transitionAdminFormDataStatus(to: "accepted") — fires the REAL M5-T1
//      hook, which mints the Attendee. A replayed request finds the
//      submission already accepted (INVALID_TRANSITION) and returns the same
//      refs as success — idempotent end to end;
//   4. self-heal (review S-1): success is only reported once the Attendee
//      actually exists. If the accept hook crashed (this call or the
//      original call a replay is retrying), the route re-invokes the
//      exported idempotent onSubmissionAccepted directly — a failure here is
//      a truthful 500, never "Attendee registered" without an attendee.
//
// Route-owned validations (spec T2):
// - session -> write:events -> org-owned event (401/403/404, IDOR-safe);
// - paymentMethod ∈ {invoice, comp, none} ONLY — card paths are rejected
//   ("Card payments go through the public flow", no PCI surface). Inactive
//   paths ARE allowed: manual registration is an admin capability, not a
//   public surface (decision — organizers keep e.g. a hidden comp path);
// - personal fields validate against the event form's non-commerce question
//   schema (buildFormSubmissionSchema — T2 AC-7: missing email -> 400);
// - ticket selection re-validates server-side via the M3 rules
//   (validateTicketSelection: eligibility × open × priced); capacity and
//   pricing are enforced by placeOrder (SOLD_OUT/TYPE_FULL -> 409, T2 AC-5).
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildFormSubmissionSchema,
  getNonCommerceFields,
} from "@/features/form/schema";
import { validateTicketSelection } from "@/features/public-registration/server/tickets";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { onSubmissionAccepted } from "@/features/responses/on-submission-accepted";
import { getAdminFormForEvent } from "@/lib/db/adminForm";
import {
  createAdminFormDataForDraft,
  getAdminFormDataForEvent,
  transitionAdminFormDataStatus,
} from "@/lib/db/adminFormData";
import { getAdminRegistrationPathForEvent } from "@/lib/db/adminRegistrationPath";
import { getAdminTicketTypeForEvent } from "@/lib/db/adminTicketType";
import { formDataIdFromDraftId } from "@/lib/db/formDataId";
import { placeOrder, type PlaceOrderErrorCode } from "@/lib/orders/place-order";
import { SimulatedPaymentProvider } from "@/lib/payments/simulated-payment-provider";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const RegisterAttendeeSchema = z.object({
  // Client-minted per dialog open (crypto.randomUUID) — the idempotency
  // seed. Charset-limited so the synthetic draft id stays unambiguous.
  requestId: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/),
  pathId: z.string().trim().min(1).max(128),
  ticketTypeId: z.string().trim().min(1).max(128),
  registrationTypeId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .nullable()
    .default(null),
  // Loose outer shape; the real validation is the form-derived schema below.
  submission: z.record(z.string().max(200), z.string().max(5000)),
});

// Maps placeOrder failures to the dialog's inline-error surface (mirrors the
// public finalize table; PAYMENT_FAILED is unreachable — card is rejected
// above the pipeline).
function mapPlaceOrderError(code: PlaceOrderErrorCode, message: string) {
  switch (code) {
    case "SOLD_OUT":
    case "TYPE_FULL":
      return NextResponse.json(
        { error: "That ticket just sold out.", code },
        { status: 409 },
      );
    case "PRICE_CHANGED":
      return NextResponse.json(
        { error: "Prices were updated — please review.", code },
        { status: 409 },
      );
    case "INVALID_METHOD":
      return NextResponse.json(
        {
          error:
            "This path's payment method can't cover a paid ticket — use an invoice path instead.",
          code,
        },
        { status: 409 },
      );
    case "PAYMENT_FAILED":
      return NextResponse.json({ error: message, code }, { status: 402 });
    default:
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
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = RegisterAttendeeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  // --- Path: must belong to this event; offline payment methods only. ---
  const path = await getAdminRegistrationPathForEvent({
    pathId: parsed.data.pathId,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!path) {
    return NextResponse.json(
      { error: "Registration path not found." },
      { status: 404 },
    );
  }
  if (path.paymentMethod === "card") {
    return NextResponse.json(
      {
        error: "Card payments go through the public flow.",
        code: "CARD_PATH",
      },
      { status: 400 },
    );
  }

  // --- Form: the submission validates against the event form's question
  // fields, exactly like the public step 1. ---
  const form = await getAdminFormForEvent({
    eventId,
    eventName: scope.event.name,
    organizationId: scope.organizationId,
    formPath: scope.event.formPath,
  });
  if (!form) {
    return NextResponse.json(
      {
        error: "This event has no registration form yet.",
        code: "NO_FORM",
      },
      { status: 409 },
    );
  }

  const questionFields = getNonCommerceFields(form.fields);
  const submissionSchema = buildFormSubmissionSchema(questionFields);
  const submission = submissionSchema.safeParse(parsed.data.submission);
  if (!submission.success) {
    return NextResponse.json(
      { error: submission.error.flatten() },
      { status: 400 },
    );
  }

  // --- Ticket selection: the M3 rules (eligibility × open × priced +
  // audience resolution) — client prefilters are advisory only. ---
  const selection = await validateTicketSelection({
    eventId,
    organizationId: scope.organizationId,
    path,
    ticketTypeId: parsed.data.ticketTypeId,
    requestedRegistrationTypeId: parsed.data.registrationTypeId,
  });
  if (!selection.ok) {
    if (selection.code === "CHOICE_REQUIRED") {
      return NextResponse.json(
        {
          error: "Choose a registration type for this ticket.",
          code: "CHOICE_REQUIRED",
        },
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
  // NO sold-out precheck here (QA D-1): capacity is enforced by placeOrder
  // AFTER its idempotency-replay lookup, mirroring the public finalize. A
  // route-level `selection.soldOut` 409 would fire before placeOrder could
  // recognize a retried requestId, falsely rejecting an already-successful
  // registration at exact capacity and making the S-1 heal block unreachable.

  // The FormData id is deterministic from the synthetic manual draft id —
  // known BEFORE the order exists, so the Order links to its submission from
  // birth and retries land on the same doc (public finalize contract).
  const manualDraftId = `manual:${parsed.data.requestId}`;
  const formDataId = formDataIdFromDraftId({
    organizationId: scope.organizationId,
    eventId,
    draftId: manualDraftId,
  });

  // --- 1. placeOrder — method/currency from the PATH doc, never the client.
  const result = await placeOrder({
    organizationId: scope.organizationId,
    eventId,
    idempotencyKey: `manual:${parsed.data.requestId}`,
    submissionId: formDataId,
    ticketTypeId: selection.ticket.id,
    registrationTypeId: selection.registrationTypeId,
    promotionId: null,
    currency: path.currency,
    paymentMethod: path.paymentMethod,
    provider: new SimulatedPaymentProvider(),
  });
  if (!result.ok) {
    return mapPlaceOrderError(result.code, result.message);
  }

  // --- 2. FormData (create-if-absent at the deterministic id). Ticket label
  // denorm comes from the AUTHORITATIVE ORDER, mirroring public finalize. ---
  const ticket = await getAdminTicketTypeForEvent({
    ticketTypeId: result.order.ticketTypeId,
    eventId,
    organizationId: scope.organizationId,
  });
  const ticketLabel = ticket?.name ?? null;

  const formDataResult = await createAdminFormDataForDraft({
    organizationId: scope.organizationId,
    eventId,
    draftId: manualDraftId,
    formId: form.id,
    submission: {
      ...submission.data,
      ...(ticketLabel ? { ticket: ticketLabel } : {}),
    },
    orderId: result.orderId,
    pathId: path.id,
    ticketLabel,
  });

  // --- 3. Auto-accept — fires the M5-T1 hook (Attendee create). A replayed
  // request finds "accepted" already terminal (INVALID_TRANSITION) and
  // returns the same refs: the double-submit produced exactly one
  // order/submission/attendee (T2 AC-6).
  const transition = await transitionAdminFormDataStatus({
    responseId: formDataResult.formDataId,
    eventId,
    organizationId: scope.organizationId,
    to: "accepted",
  });
  if (!transition.ok && transition.code !== "INVALID_TRANSITION") {
    return NextResponse.json({ error: transition.message }, { status: 500 });
  }

  // --- 4. Self-heal (review S-1): an accepted submission with no Attendee is
  // invisible on the roster, so "accepted" alone is not success here. Two
  // paths can leave that orphan: (a) THIS accept committed but its hook
  // crashed (acceptHookFailed); (b) a replay hit INVALID_TRANSITION because
  // the ORIGINAL accept committed before its hook crashed. In both cases
  // re-read the submission and, while attendeeCreated is still pending,
  // re-invoke the exported idempotent hook directly. Only the healthy accept
  // (hook completed inside the transition) skips the verification read.
  const acceptNeedsVerification =
    !transition.ok || transition.acceptHookFailed === true;
  if (acceptNeedsVerification) {
    const submission = await getAdminFormDataForEvent({
      responseId: formDataResult.formDataId,
      eventId,
      organizationId: scope.organizationId,
    });
    if (!submission) {
      return NextResponse.json(
        { error: "Registration record not found after accept." },
        { status: 500 },
      );
    }
    if (
      submission.status === "accepted" &&
      submission.attendeeCreated !== true
    ) {
      try {
        await onSubmissionAccepted(submission);
      } catch (error) {
        console.error(
          `[attendees/register] attendee creation failed for accepted submission ${formDataResult.formDataId}`,
          error,
        );
        return NextResponse.json(
          {
            error:
              "The registration was recorded but the attendee record could not be created. Please retry.",
            code: "ATTENDEE_CREATION_FAILED",
          },
          { status: 500 },
        );
      }
    }
  }

  return NextResponse.json({
    registrationRef: formDataResult.formDataId,
    orderRef: result.orderId,
    paymentStatus: result.order.paymentStatus,
  });
}
