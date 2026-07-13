"use client";

// Public multi-step registration flow orchestrator (M3-T3, design §3).
// Owns the draft lifecycle (create → step PATCHes → finalize), the server
// quote, and the typed-error surfaces. All money and eligibility comes from
// the server; this component never computes an amount (T3 AC-5) and never
// sends payment method/currency — finalize reads them from the path doc
// (T3 AC-6). The draft token lives in sessionStorage and request bodies
// only (never URLs).

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { FormFieldValues } from "@/features/form/schema";
import {
  buildPublicFlowSteps,
  flowStepIndex,
  isPaymentSkipped,
  primaryActionLabel,
  resumeStepIndex,
  type FlowStepId,
} from "@/features/public-registration/steps";
import { mapFinalizeErrorToSurface } from "@/features/public-registration/errors";
import { useRegistrationDraft } from "@/features/public-registration/use-registration-draft";
import type {
  CommerceFieldConfig,
  FinalizeSuccess,
  PublicRegistrationQuote,
  PublicTicketOption,
  SerializedFlowPath,
} from "@/features/public-registration/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmationStep } from "./confirmation-step";
import { PaymentStep, isCardFormPlausible, type CardFormState } from "./payment-step";
import { PersonalInfoStep } from "./personal-info-step";
import { StepperHeader } from "./stepper-header";
import { SummaryStep } from "./summary-step";
import { TicketOptionsStep, type PromoState } from "./ticket-options-step";

interface RegistrationStepperProps {
  eventId: string;
  eventName: string;
  path: SerializedFlowPath;
  questionFields: FormFieldValues[];
  ticketField: CommerceFieldConfig;
  promoField: CommerceFieldConfig | null;
}

interface ApiError {
  status: number;
  code?: string;
  message?: string;
}

async function parseApiError(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as { error?: unknown; code?: string };
    return {
      status: response.status,
      code: payload.code,
      message: typeof payload.error === "string" ? payload.error : undefined,
    };
  } catch {
    return { status: response.status };
  }
}

const EMPTY_CARD: CardFormState = {
  nameOnCard: "",
  cardNumber: "",
  expiry: "",
  cvc: "",
};

const INITIAL_PROMO: PromoState = {
  input: "",
  appliedCode: null,
  discountMinor: null,
  error: null,
  applying: false,
};

export function RegistrationStepper({
  eventId,
  eventName,
  path,
  questionFields,
  ticketField,
  promoField,
}: RegistrationStepperProps) {
  const steps = buildPublicFlowSteps(path.paymentMethod);
  const draft = useRegistrationDraft(eventId);

  const [hydrating, setHydrating] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [ticketTypeId, setTicketTypeId] = useState<string | null>(null);
  const [registrationTypeId, setRegistrationTypeId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<PublicTicketOption[] | null>(null);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [promo, setPromo] = useState<PromoState>(INITIAL_PROMO);
  const [quote, setQuote] = useState<PublicRegistrationQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [card, setCard] = useState<CardFormState>(EMPTY_CARD);
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<FinalizeSuccess | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const currentStep = steps[currentIndex];

  const goToStep = useCallback(
    (id: FlowStepId) => {
      const index = flowStepIndex(steps, id);
      if (index >= 0) setCurrentIndex(index);
    },
    [steps],
  );

  // Focus management (design §3 a11y): step changes move focus to the step
  // heading; the aria-live region below announces the step.
  const previousIndexRef = useRef(currentIndex);
  useEffect(() => {
    if (previousIndexRef.current !== currentIndex) {
      previousIndexRef.current = currentIndex;
      headingRef.current?.focus();
    }
  }, [currentIndex]);

  const fetchTickets = useCallback(async () => {
    setTicketsError(null);
    try {
      const response = await fetch(
        `/api/events/${eventId}/registration/tickets?path=${encodeURIComponent(path.id)}`,
      );
      if (!response.ok) throw new Error("tickets");
      const payload = (await response.json()) as { tickets: PublicTicketOption[] };
      if (mountedRef.current) setTickets(payload.tickets);
    } catch {
      if (mountedRef.current) {
        setTickets(null);
        setTicketsError("We couldn't load the tickets. Please retry.");
      }
    }
  }, [eventId, path.id]);

  const fetchQuote = useCallback(async () => {
    const token = draft.getToken();
    if (!token) return;
    setQuote(null);
    setQuoteError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/registration/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error("quote");
      const payload = (await response.json()) as {
        quote: PublicRegistrationQuote;
      };
      if (mountedRef.current) setQuote(payload.quote);
    } catch {
      if (mountedRef.current) {
        setQuoteError("We couldn't load your totals. Please retry.");
      }
    }
  }, [draft, eventId]);

  // Resume (T3 AC-10): a stored token re-hydrates the draft at the step
  // after lastStepReached; an invalid token silently starts fresh. NOTE: the
  // applied promo CODE text is never stored server-side (T5 AC-4), so a
  // resumed session shows its discount on the summary but not the code chip.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const state = await draft.hydrate();
      if (cancelled) return;

      if (state && state.pathId === path.id) {
        setAnswers(state.stepAnswers);
        setTicketTypeId(state.ticketTypeId);
        setRegistrationTypeId(state.registrationTypeId);
        const index = resumeStepIndex(steps, state.lastStepReached);
        setCurrentIndex(index);
        void fetchTickets();
        if (steps[index]?.id === "summary") void fetchQuote();
      } else if (state && state.pathId !== path.id) {
        // The stored draft belongs to a different path — start fresh here;
        // the old draft simply ages into an abandoned record (T5).
        draft.clearToken();
      }
      setHydrating(false);
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally mount-only: hydration runs once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Step handlers
  // ------------------------------------------------------------------

  async function handlePersonalInfoComplete(values: Record<string, string>) {
    setSubmitting(true);
    setBanner(null);
    try {
      let token = draft.getToken();

      if (token) {
        // Re-edit path: PATCH; a 404 means the old draft is gone (finalized
        // or purged) — fall through to a fresh create.
        const response = await fetch(
          `/api/events/${eventId}/registration/draft`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, step: "personal_info", submission: values }),
          },
        );
        if (response.status === 404) {
          draft.clearToken();
          token = null;
        } else if (!response.ok) {
          const error = await parseApiError(response);
          setBanner(error.message ?? "Something went wrong. Please try again.");
          return;
        }
      }

      if (!token) {
        const response = await fetch(
          `/api/events/${eventId}/registration/draft`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pathId: path.id, submission: values }),
          },
        );
        if (!response.ok) {
          const error = await parseApiError(response);
          setBanner(
            error.status === 429
              ? "Too many attempts — please wait a moment."
              : error.message ?? "Something went wrong. Please try again.",
          );
          return;
        }
        const payload = (await response.json()) as { draftToken: string };
        draft.saveToken(payload.draftToken);
      }

      setAnswers(values);
      goToStep("ticket_options");
      if (tickets === null) void fetchTickets();
    } catch {
      setBanner("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedTicket = tickets?.find((t) => t.id === ticketTypeId) ?? null;
  const needsRegistrationTypeChoice = Boolean(
    selectedTicket?.registrationTypeOptions?.length,
  );

  async function handleApplyPromo() {
    const token = draft.getToken();
    if (!token || !ticketTypeId) {
      setPromo((state) => ({ ...state, error: "Select a ticket first." }));
      return;
    }

    setPromo((state) => ({ ...state, applying: true, error: null }));
    try {
      const response = await fetch(`/api/events/${eventId}/registration/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          ticketTypeId,
          registrationTypeId: needsRegistrationTypeChoice ? registrationTypeId : null,
          promoCode: promo.input.trim(),
        }),
      });
      if (!response.ok) {
        const error = await parseApiError(response);
        setPromo((state) => ({
          ...state,
          applying: false,
          // One generic message for every promo failure (T2 AC-6).
          error:
            error.status === 429
              ? "Too many attempts — please wait a moment."
              : error.code === "CHOICE_REQUIRED"
                ? "Choose how you are registering first."
                : "This code isn't valid.",
        }));
        return;
      }
      const payload = (await response.json()) as {
        quote: PublicRegistrationQuote;
      };
      setPromo((state) => ({
        input: "",
        appliedCode: state.input.trim().toUpperCase(),
        discountMinor: payload.quote.discountMinor,
        error: null,
        applying: false,
      }));
    } catch {
      setPromo((state) => ({
        ...state,
        applying: false,
        error: "We couldn't reach the server. Please retry.",
      }));
    }
  }

  async function handleTicketContinue() {
    const token = draft.getToken();
    if (!token || !ticketTypeId) return;

    setSubmitting(true);
    setBanner(null);
    try {
      const response = await fetch(`/api/events/${eventId}/registration/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          step: "ticket_options",
          ticketTypeId,
          registrationTypeId: needsRegistrationTypeChoice ? registrationTypeId : null,
          promoCode: promo.appliedCode,
        }),
      });
      if (!response.ok) {
        const error = await parseApiError(response);
        if (error.code === "SOLD_OUT" || error.code === "SELECTION_UNAVAILABLE") {
          setBanner(error.message ?? "This selection is no longer available.");
          void fetchTickets();
        } else if (error.code === "PROMO_INVALID") {
          setPromo({ ...INITIAL_PROMO, error: "This code isn't valid." });
        } else {
          setBanner(error.message ?? "Something went wrong. Please try again.");
        }
        return;
      }

      goToStep("summary");
      void fetchQuote();
    } catch {
      setBanner("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setSubmitting(false);
    }
  }

  async function patchStepMarker(step: "summary" | "payment"): Promise<boolean> {
    const token = draft.getToken();
    if (!token) return false;
    try {
      const response = await fetch(`/api/events/${eventId}/registration/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, step }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function handleFinalize() {
    const token = draft.getToken();
    if (!token) return;

    setSubmitting(true);
    setBanner(null);
    try {
      const response = await fetch(
        `/api/events/${eventId}/registration/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        },
      );

      if (!response.ok) {
        const error = await parseApiError(response);
        const surface = mapFinalizeErrorToSurface(error);
        if (surface.kind === "toast") {
          toast.error(surface.message);
        } else {
          setBanner(surface.message);
        }
        if (surface.clearPromo) setPromo(INITIAL_PROMO);
        if (surface.refreshTickets) void fetchTickets();
        if (surface.goToStep) goToStep(surface.goToStep);
        if (surface.requote) void fetchQuote();
        return;
      }

      const payload = (await response.json()) as FinalizeSuccess;
      // Completed drafts are deleted server-side; drop the now-dead token.
      draft.clearToken();
      setConfirmation(payload);
      goToStep("confirmation");
    } catch {
      setBanner("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSummaryContinue() {
    setSubmitting(true);
    setBanner(null);
    try {
      await patchStepMarker("summary");
      if (isPaymentSkipped(path.paymentMethod)) {
        await handleFinalize();
        return;
      }
      goToStep("payment");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePaymentSubmit() {
    if (path.paymentMethod === "card" && !isCardFormPlausible(card)) {
      setBanner("Enter your card details to continue.");
      return;
    }
    setSubmitting(true);
    setBanner(null);
    try {
      await patchStepMarker("payment");
      await handleFinalize();
    } finally {
      setSubmitting(false);
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  if (hydrating) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading registration">
        <Skeleton className="h-10 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-[2rem]" />
      </div>
    );
  }

  const primaryLabel = primaryActionLabel(steps, currentIndex, path.paymentMethod);
  const primaryDisabled =
    submitting ||
    (currentStep.id === "ticket_options" &&
      (!ticketTypeId ||
        (needsRegistrationTypeChoice && !registrationTypeId) ||
        (tickets !== null && tickets.length === 0))) ||
    (currentStep.id === "summary" && (quote === null || quoteError !== null)) ||
    (currentStep.id === "payment" &&
      path.paymentMethod === "card" &&
      !isCardFormPlausible(card));

  function handlePrimaryAction() {
    if (currentStep.id === "ticket_options") void handleTicketContinue();
    else if (currentStep.id === "summary") void handleSummaryContinue();
    else if (currentStep.id === "payment") void handlePaymentSubmit();
  }

  return (
    <div className="space-y-6">
      <StepperHeader steps={steps} currentIndex={currentIndex} />

      <p aria-live="polite" className="sr-only">
        Step {currentIndex + 1} of {steps.length}: {currentStep.title}
      </p>

      <section className="space-y-5 rounded-[2rem] border border-white/80 bg-white/90 p-6 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.4)]">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold text-slate-950 outline-none"
        >
          {currentStep.title}
        </h2>

        {currentStep.id === "personal_info" ? (
          <PersonalInfoStep
            fields={questionFields}
            initialValues={answers}
            submitting={submitting}
            onComplete={handlePersonalInfoComplete}
          />
        ) : null}

        {currentStep.id === "ticket_options" ? (
          <TicketOptionsStep
            eventId={eventId}
            tickets={tickets}
            ticketsError={ticketsError}
            onRetryTickets={() => void fetchTickets()}
            ticketField={ticketField}
            promoField={promoField}
            selectedTicketId={ticketTypeId}
            selectedRegistrationTypeId={registrationTypeId}
            onSelectTicket={(id) => {
              setTicketTypeId(id);
              setRegistrationTypeId(null);
            }}
            onSelectRegistrationType={setRegistrationTypeId}
            promo={promo}
            onPromoInputChange={(value) =>
              setPromo((state) => ({ ...state, input: value, error: null }))
            }
            onApplyPromo={() => void handleApplyPromo()}
            onRemovePromo={() => setPromo(INITIAL_PROMO)}
          />
        ) : null}

        {currentStep.id === "summary" ? (
          <SummaryStep
            fields={questionFields}
            answers={answers}
            ticketName={selectedTicket?.name ?? null}
            appliedPromoCode={promo.appliedCode}
            quote={quote}
            quoteError={quoteError}
            onRetryQuote={() => void fetchQuote()}
            onEditPersonalInfo={() => goToStep("personal_info")}
          />
        ) : null}

        {currentStep.id === "payment" && path.paymentMethod !== "comp" &&
        path.paymentMethod !== "none" ? (
          <PaymentStep
            method={path.paymentMethod}
            email={answers.email ?? ""}
            card={card}
            onCardChange={setCard}
          />
        ) : null}

        {currentStep.id === "confirmation" && confirmation ? (
          <ConfirmationStep result={confirmation} />
        ) : null}

        {banner ? (
          <div
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          >
            {banner}
          </div>
        ) : null}

        {currentStep.id !== "personal_info" &&
        currentStep.id !== "confirmation" ? (
          <div className="flex items-center justify-between gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            >
              Back
            </Button>
            <Button
              type="button"
              disabled={primaryDisabled}
              onClick={handlePrimaryAction}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                primaryLabel
              )}
            </Button>
          </div>
        ) : null}
      </section>

      <p className="text-center text-xs text-slate-500">
        Registering for {eventName}
        {" · "}
        {path.name}
      </p>
    </div>
  );
}
