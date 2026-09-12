"use client";

// M9-T1 — the "Create ticket" wizard's outer shell (spec:
// agents/docs/specs/m9-ticket-wizard.md §2, §5, §7). Primary "Create ticket"
// entry point on the Ticket Types screen: a 3-step dialog that produces the
// same three Firestore writes today's split Registration Types -> Ticket
// Types -> Pricing flow requires (one RegistrationType possibly created
// inline in Step 2, one TicketType, N Fees), in a single atomic POST from
// Step 3. Create only — editing an existing ticket's audience/price stays on
// the existing Ticket Types + Pricing screens (spec §5 non-goals).
//
// STEP-NAVIGATION STATE MACHINE (why it's shaped this way):
// Step 1 (Ticket details) is a real React Hook Form (`detailsForm`) because
// its fields need the same Zod-driven field-level errors as every other
// dialog in this app. Steps 2/3 are NOT a second RHF form — Step 2's audience
// table is a dynamically-growing list (rows can be appended mid-session by
// the inline quick-add) that doesn't map cleanly onto RHF's static field
// array ergonomics for this size of feature, so it is plain component state
// (`rows`) validated on demand via `validateTicketWizardAudienceRows`
// (spec §6 edge case 5: a checked-but-unpriced row must block advancing to
// Step 3, not be silently sent as an incomplete payload). `goNext` is the
// only place that runs this validation, so a row can be freely edited while
// still on Step 2 without error noise on every keystroke.
//
// Final submit posts once, from Step 3, to the new atomic route. A 409/400
// from that submit is routed BACK to the step that owns the invalid field
// (code -> Step 1, prices -> Step 2, spec §6 edge cases 2 and 10) instead of
// only showing a generic toast — see handleFinalSubmit's error branch.
import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import {
  StepAudiencePricing,
  type DefaultAudienceLimit,
} from "@/features/ticket-wizard/components/step-audience-pricing";
import { StepDetails } from "@/features/ticket-wizard/components/step-details";
import { StepReview } from "@/features/ticket-wizard/components/step-review";
import {
  buildTicketWithPricingRequestPayload,
  capacitySchema,
  ticketWizardDetailsFormSchema,
  validateTicketWizardAudienceRows,
  type TicketWizardAudienceRow,
  type TicketWizardDetailsFormValues,
} from "@/features/ticket-wizard/schemas";
import type { SerializedRegistrationType } from "@/features/registration/types";

interface CreateTicketWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  registrationTypes: SerializedRegistrationType[];
  timeZone: string;
  onSaved: () => void;
}

const STEP_LABELS = ["Ticket details", "Audience & price", "Review & publish"];
const TOTAL_STEPS = STEP_LABELS.length;

// Seeds a fresh creation session; code suggestions update as the name is typed.
function buildDefaultDetailsValues(): TicketWizardDetailsFormValues {
  return {
    name: "",
    code: "TICKET",
    limitCapacity: false,
    capacity: "",
    salesStart: "",
    salesEnd: "",
    scheduleSales: false,
  };
}

// Existing audiences start unselected; empty events get one local General attendee draft.
function buildRowsFromRegistrationTypes(
  registrationTypes: SerializedRegistrationType[],
): TicketWizardAudienceRow[] {
  if (registrationTypes.length === 0)
    return [
      {
        registrationTypeId: "__default_general_attendee__",
        name: "General attendee",
        code: "GENERAL",
        included: true,
        price: "",
        isDefaultDraft: true,
      },
    ];
  return registrationTypes.map((registrationType) => ({
    registrationTypeId: registrationType.id,
    name: registrationType.name,
    code: registrationType.code,
    included: false,
    price: "",
    capacity: registrationType.capacity,
  }));
}

/** Creates a ticket and its audience prices through a validated three-step flow. */
export function CreateTicketWizard({
  open,
  onOpenChange,
  eventId,
  registrationTypes,
  timeZone,
  onSaved,
}: CreateTicketWizardProps) {
  // Retain newly saved audiences until refreshed server props acknowledge them.
  // This covers closing and reopening before router.refresh has finished.
  const pendingAudiences = useRef(
    new Map<string, SerializedRegistrationType>(),
  );
  const pendingEventId = useRef(eventId);
  const publishing = useRef(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<TicketWizardAudienceRow[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  // Banner for a step-2-owned server error that has no single row to attach
  // to (the UNKNOWN_REGISTRATION_TYPE case, spec §6 edge case 10 — a type
  // deleted by someone else between Step 2 and Step 3 submit).
  const [audienceServerError, setAudienceServerError] = useState<string | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [resolvingDefault, setResolvingDefault] = useState(false);
  const [codeEdited, setCodeEdited] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [defaultLimit, setDefaultLimit] = useState<DefaultAudienceLimit>({
    limited: false,
    capacity: "",
  });
  const busy = submitting || resolvingDefault || quickAddSaving;

  const detailsForm = useForm<TicketWizardDetailsFormValues>({
    resolver: zodResolver(ticketWizardDetailsFormSchema),
    defaultValues: buildDefaultDetailsValues(),
  });

  // Server values become authoritative once a newly saved audience appears in props.
  useEffect(() => {
    if (pendingEventId.current !== eventId) {
      pendingAudiences.current.clear();
      pendingEventId.current = eventId;
    }
    for (const type of registrationTypes)
      pendingAudiences.current.delete(type.id);
  }, [registrationTypes, eventId]);

  // Cache an immediate audience write and refresh the surrounding management screen.
  const rememberSavedAudience = (audience: SerializedRegistrationType) => {
    pendingAudiences.current.set(audience.id, audience);
    onSaved();
  };

  // Re-seed every field of wizard state whenever the dialog transitions to
  // open — deliberately NOT depending on `registrationTypes` (which can
  // change reference on unrelated parent re-renders while the wizard stays
  // open, e.g. after the quick-add's own POST) so an in-progress session's
  // checked rows / quick-added rows are never wiped out from under the user.
  useEffect(() => {
    if (open) {
      setStep(1);
      detailsForm.reset(buildDefaultDetailsValues());
      setRows(
        buildRowsFromRegistrationTypes([
          ...registrationTypes,
          ...pendingAudiences.current.values(),
        ]),
      );
      setRowErrors({});
      setAudienceServerError(null);
      setCodeEdited(false);
      setAdvancedOpen(false);
      setQuickAddOpen(false);
      setQuickAddSaving(false);
      setDefaultLimit({ limited: false, capacity: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId]);

  // Keep open inline drafts in place until explicitly added or cancelled.
  const goBack = () => {
    if (busy || quickAddOpen) return;
    if (step > 1) {
      setStep((current) => (current - 1) as 1 | 2);
    }
  };

  // Step 1 -> Step 2: run the RHF resolver (same as every other dialog's
  // submit-time validation) before advancing.
  const goNextFromDetails = async () => {
    const valid = await detailsForm.trigger();
    if (detailsForm.getFieldState("code").error) setAdvancedOpen(true);
    if (valid) {
      setStep(2);
    }
  };

  // Resolve the empty-event draft only after an explicit Continue or Publish.
  // The endpoint reuses an existing default and returns its actual saved limit.
  const resolveDefaultAudience = async (): Promise<
    TicketWizardAudienceRow[] | null
  > => {
    const draft = rows.find((row) => row.included && row.isDefaultDraft);
    if (!draft) return rows;
    setResolvingDefault(true);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/registration-types/default`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capacity: defaultLimit.limited
              ? Number(defaultLimit.capacity)
              : null,
          }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        setAudienceServerError(
          typeof data?.error === "string"
            ? data.error
            : "Could not prepare General attendee. Please try again.",
        );
        return null;
      }
      const saved = (await response.json()) as {
        registrationTypeId: string;
        name: string;
        code: string;
        capacity: number | null;
      };
      if (!saved.registrationTypeId)
        throw new Error("Missing default registration type id");
      // A separately quick-added type may already be the default returned by the endpoint.
      const existing = rows.find(
        (row) =>
          !row.isDefaultDraft &&
          row.registrationTypeId === saved.registrationTypeId,
      );
      const resolved = rows.flatMap((row) => {
        if (!row.isDefaultDraft) return [row];
        if (existing) return [];
        return [
          {
            ...row,
            registrationTypeId: saved.registrationTypeId,
            name: saved.name,
            code: saved.code,
            capacity: saved.capacity,
            isDefaultDraft: false,
          },
        ];
      });
      if (existing) {
        const existingIndex = resolved.findIndex(
          (row) => row.registrationTypeId === existing.registrationTypeId,
        );
        resolved[existingIndex] = {
          ...existing,
          included: true,
          price: existing.included ? existing.price : draft.price,
          capacity: saved.capacity,
        };
      }
      setRows(resolved);
      rememberSavedAudience({
        id: saved.registrationTypeId,
        name: saved.name,
        code: saved.code,
        capacity: saved.capacity,
        registeredCount: 0,
      });
      return resolved;
    } catch {
      setAudienceServerError(
        "Could not prepare General attendee. Check your connection and try again.",
      );
      return null;
    } finally {
      setResolvingDefault(false);
    }
  };

  // Require a chosen audience with a valid price before creating its default or advancing.
  const goNextFromAudience = async () => {
    if (busy || quickAddOpen) return;
    const errors = validateTicketWizardAudienceRows(rows);
    if (
      rows.some((row) => row.included && row.isDefaultDraft) &&
      defaultLimit.limited
    ) {
      const parsed = capacitySchema.safeParse(
        defaultLimit.capacity.trim() ? Number(defaultLimit.capacity) : 0,
      );
      if (!parsed.success)
        errors.defaultCapacity = parsed.error.issues[0].message;
    }
    setRowErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setAudienceServerError(null);
    if (await resolveDefaultAudience()) setStep(3);
  };

  // Closing during a write would hide its result and invite an accidental retry.
  const handleClose = () => {
    if (!busy) {
      onOpenChange(false);
    }
  };

  // Publish enables sales, while server-side dates and quantities still determine availability.
  const handleFinalSubmit = async () => {
    if (busy || quickAddOpen || publishing.current) return;
    publishing.current = true;
    setSubmitting(true);
    try {
      const resolvedRows = await resolveDefaultAudience();
      if (!resolvedRows) {
        setStep(2);
        return;
      }
      const payload = buildTicketWithPricingRequestPayload(
        detailsForm.getValues(),
        resolvedRows,
      );
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/tickets/with-pricing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: unknown;
          field?: unknown;
        } | null;
        const field = typeof data?.field === "string" ? data.field : null;
        const message =
          typeof data?.error === "string"
            ? data.error
            : "Failed to create the ticket.";

        // Route the user back to whichever step owns the invalid field
        // instead of leaving them stranded on Step 3 with a generic toast
        // (spec §6 edge cases 2 and 10).
        if (field === "code") {
          setStep(1);
          setAdvancedOpen(true);
          detailsForm.setError("code", { type: "server", message });
          return;
        }
        if (field === "prices") {
          setStep(2);
          setAudienceServerError(message);
          return;
        }
        toast.error(message);
        return;
      }

      toast.success("Ticket created");
      onOpenChange(false);
      onSaved();
    } catch {
      // Network failure — toast and keep the dialog open for a retry (repo
      // convention, see ticket-type-dialog.tsx).
      toast.error("Failed to create the ticket.", {
        description: "Check your connection and try again.",
      });
    } finally {
      publishing.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create ticket</DialogTitle>
          <DialogDescription>
            Set up your ticket, choose your audience, and publish.
          </DialogDescription>
        </DialogHeader>

        <WizardStepper currentStep={step} />

        {step === 1 ? (
          <Form {...detailsForm}>
            <StepDetails
              form={detailsForm}
              codeEdited={codeEdited}
              onCodeEdited={() => setCodeEdited(true)}
              advancedOpen={advancedOpen}
              onAdvancedOpenChange={setAdvancedOpen}
              timeZone={timeZone}
            />
          </Form>
        ) : null}

        {step === 2 ? (
          <StepAudiencePricing
            eventId={eventId}
            rows={rows}
            onRowsChange={setRows}
            rowErrors={rowErrors}
            serverError={audienceServerError}
            quickAddOpen={quickAddOpen}
            onQuickAddOpenChange={setQuickAddOpen}
            onQuickAddSavingChange={setQuickAddSaving}
            onRegistrationTypeSaved={rememberSavedAudience}
            defaultLimit={defaultLimit}
            onDefaultLimitChange={setDefaultLimit}
            busy={busy}
          />
        ) : null}

        {step === 3 ? (
          <StepReview
            details={detailsForm.getValues()}
            rows={rows}
            timeZone={timeZone}
          />
        ) : null}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            Step {step} of {TOTAL_STEPS} · {STEP_LABELS[step - 1]}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || quickAddOpen}
              onClick={step === 1 ? handleClose : goBack}
            >
              {step === 1 ? "Cancel" : "Back"}
            </Button>
            {step === 1 ? (
              <Button type="button" disabled={busy} onClick={goNextFromDetails}>
                Continue
              </Button>
            ) : null}
            {step === 2 ? (
              <Button
                type="button"
                disabled={busy || quickAddOpen}
                onClick={goNextFromAudience}
              >
                {resolvingDefault ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                Continue
              </Button>
            ) : null}
            {step === 3 ? (
              <Button
                type="button"
                disabled={busy || quickAddOpen}
                onClick={handleFinalSubmit}
              >
                {submitting ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                Publish ticket
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Small inline stepper: done / current / upcoming dots + labels, mirrors the
// approved mockup's stepper interaction (scratchpad/ticket-wizard-mockup.html)
// using real shadcn/ui primitives (no raw HTML/CSS from the mockup itself).
function WizardStepper({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  return (
    <ol className="flex items-center gap-1" aria-label="Wizard progress">
      {STEP_LABELS.map((label, index) => {
        const stepNumber = index + 1;
        const done = stepNumber < currentStep;
        const current = stepNumber === currentStep;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-current={current ? "step" : undefined}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                done
                  ? "bg-emerald-600 text-white"
                  : current
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? (
                <Check aria-hidden="true" className="h-3.5 w-3.5" />
              ) : (
                stepNumber
              )}
            </span>
            <span
              className={`text-xs font-medium ${
                current || done ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
            {stepNumber < STEP_LABELS.length ? (
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
