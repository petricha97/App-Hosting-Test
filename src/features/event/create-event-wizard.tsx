"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CREATE screen — step-by-step event wizard.
// ─────────────────────────────────────────────────────────────────────────────
// This is the multi-step (5-card) flow used to CREATE a new event, rendered by
// src/app/dashboard/(workspace)/events/new/page.tsx. A wizard guides a
// first-time creator; per-step validation blocks "Next" until that step is
// valid. EDITING an existing event uses the flat single-page form instead
// (src/features/event/create-event-workspace.tsx).
//
// The field markup is NOT defined here — steps 1/2/4 delegate to the SHARED
// field groups in src/features/event/fields/* (the same components the edit
// workspace renders), so each field is defined once. This file owns the step
// sequence, the stepper, per-step validation, the Review step, and submit.
// Save logic lives in event-form-core.ts → submitEventForm.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  FileStack,
  Globe,
  Loader2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useForm, type FieldPath } from "react-hook-form";

import { useAuth } from "@/contexts/AuthContext";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import {
  eventFormSchema,
  type EventFormInput,
  type EventFormValues,
} from "@/features/event/schema";
import {
  PENDING_FORM_PATH,
  buildOrganizationPath,
  buildWorkspaceDefaults,
  submitEventForm,
} from "@/features/event/event-form-core";
import {
  WIZARD_STEPS,
  getStepFields,
  type WizardStepKey,
} from "@/features/event/wizard/steps";
import { WizardStepper } from "@/features/event/wizard/wizard-stepper";
import { StepBasics } from "@/features/event/wizard/step-basics";
import { StepSchedule } from "@/features/event/wizard/step-schedule";
import { StepRegistration } from "@/features/event/wizard/step-registration";
import { StepPublicPage } from "@/features/event/wizard/step-public-page";
import { StepReview } from "@/features/event/wizard/step-review";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Form } from "@/components/ui/form";

const STEP_ICONS: Record<WizardStepKey, LucideIcon> = {
  basics: Sparkles,
  schedule: CalendarClock,
  registration: FileStack,
  page: Globe,
  review: ClipboardCheck,
};

const FIELD_TO_STEP: Partial<Record<keyof EventFormInput, number>> = {
  name: 0,
  description: 0,
  capacity: 0,
  expectedGuests: 0,
  timezone: 1,
  allowOverlap: 1,
  registrationPeriod: 1,
  periods: 1,
  pageMode: 3,
  redirectUrl: 3,
  status: 4,
};

const LAST_STEP_INDEX = WIZARD_STEPS.length - 1;

/**
 * The create-event wizard. Owns the step index, which steps have been visited
 * (for the clickable stepper) and which are errored, the react-hook-form
 * instance, and per-step validation. Renders the current step's fields (from the
 * shared field groups) and a footer that advances / submits.
 */
export function CreateEventWizard() {
  const router = useRouter();
  const { organization, organizationId, initializing } = useAuth();
  const todayDateString = useMemo(
    () => new Date().toISOString().slice(0, 10),
    [],
  );

  const organizationPathDefault = useMemo(
    () => buildOrganizationPath(organizationId),
    [organizationId],
  );

  const defaultValues = useMemo(
    () => buildWorkspaceDefaults(organizationPathDefault, todayDateString),
    [organizationPathDefault, todayDateString],
  );

  const form = useForm<EventFormInput, undefined, EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues,
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [visited, setVisited] = useState<boolean[]>(() =>
    WIZARD_STEPS.map((_, index) => index === 0),
  );
  const [errored, setErrored] = useState<boolean[]>(() =>
    WIZARD_STEPS.map(() => false),
  );

  useEffect(() => {
    const currentPath = form.getValues("organizationPath");
    const isUntouched = !form.getFieldState("organizationPath").isDirty;

    if (organizationPathDefault && (!currentPath || isUntouched)) {
      form.setValue("organizationPath", organizationPathDefault, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [form, organizationPathDefault]);

  useEffect(() => {
    if (form.getValues("formPath") !== PENDING_FORM_PATH) {
      form.setValue("formPath", PENDING_FORM_PATH, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [form]);

  const currentStep = WIZARD_STEPS[currentIndex];
  const isReview = currentStep.key === "review";
  const selectedStatus = form.watch("status");
  const isSubmitting = form.formState.isSubmitting;

  /** Move to a step (clamped to range), mark it visited, and scroll to top. */
  function goTo(index: number) {
    const next = Math.max(0, Math.min(LAST_STEP_INDEX, index));
    setVisited((prev) => {
      if (prev[next]) return prev;
      const draft = [...prev];
      draft[next] = true;
      return draft;
    });
    setCurrentIndex(next);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  /** Move keyboard focus to the first field in the list that failed validation. */
  function focusFirstInvalid(fields: Array<FieldPath<EventFormInput>>) {
    const firstInvalid = fields.find(
      (name) => form.getFieldState(name).invalid,
    );
    if (firstInvalid) {
      form.setFocus(firstInvalid);
    }
  }

  /**
   * "Next" handler. On the Review step it submits; otherwise it validates only
   * this step's fields (`form.trigger`), flags the step on failure and focuses
   * the first bad field, and advances when valid. Optional steps have no fields
   * to trigger, so they always pass.
   */
  async function handleNext() {
    if (isReview) {
      await handleSubmit();
      return;
    }

    const fields = getStepFields(currentStep.key, form.getValues("pageMode"));
    const valid = fields.length === 0 ? true : await form.trigger(fields);

    setErrored((prev) => {
      const draft = [...prev];
      draft[currentIndex] = !valid;
      return draft;
    });

    if (!valid) {
      focusFirstInvalid(fields);
      return;
    }

    goTo(currentIndex + 1);
  }

  /**
   * Called when a full-form submit fails validation: maps each error back to its
   * step (via FIELD_TO_STEP), flags those steps red in the stepper, and jumps to
   * the first errored step so the user lands on the problem.
   */
  function markErroredStepsFromForm() {
    const errorKeys = Object.keys(form.formState.errors) as Array<
      keyof EventFormInput
    >;
    setErrored(() => {
      const draft = WIZARD_STEPS.map(() => false);
      errorKeys.forEach((key) => {
        const stepIndex = FIELD_TO_STEP[key];
        if (stepIndex !== undefined) draft[stepIndex] = true;
      });
      return draft;
    });
    const firstErroredStep = errorKeys
      .map((key) => FIELD_TO_STEP[key])
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b)[0];
    if (firstErroredStep !== undefined) goTo(firstErroredStep);
  }

  /**
   * Validates the whole form, then either saves the event (shared submit logic)
   * or, on failure, routes the user back to the first errored step.
   */
  const handleSubmit = form.handleSubmit(
    async (values) => {
      await submitEventForm({ mode: "create", values, router });
    },
    () => {
      markErroredStepsFromForm();
    },
  );

  /** "Save & exit" — force status to Draft, then run the normal submit. */
  async function handleSaveDraft() {
    form.setValue("status", "Draft", { shouldDirty: true });
    await handleSubmit();
  }

  const primaryLabel = isReview
    ? selectedStatus === "Published"
      ? "Publish event"
      : "Submit"
    : "Next";

  const StepIcon = STEP_ICONS[currentStep.key];

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Create event"
        title="Create a new event"
        description="Move through each step — every step validates on its own before you continue."
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard/events">Back to Events</Link>
          </Button>
        }
      />

      <WizardStepper
        steps={WIZARD_STEPS}
        currentIndex={currentIndex}
        visited={visited}
        errored={errored}
        onJump={goTo}
      />

      <Form {...form}>
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                <StepIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
                  {currentStep.kicker}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <CardTitle className="text-2xl text-slate-950">
                    {currentStep.title}
                  </CardTitle>
                  {currentStep.optional ? (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Optional
                    </span>
                  ) : null}
                </div>
                <CardDescription className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
                  {currentStep.description}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-2">
            {currentStep.key === "basics" ? <StepBasics form={form} /> : null}
            {currentStep.key === "schedule" ? (
              <StepSchedule form={form} todayDateString={todayDateString} />
            ) : null}
            {currentStep.key === "registration" ? <StepRegistration /> : null}
            {currentStep.key === "page" ? <StepPublicPage form={form} /> : null}
            {currentStep.key === "review" ? (
              <StepReview form={form} onEdit={goTo} />
            ) : null}
          </CardContent>
        </Card>
      </Form>

      <div className="sticky bottom-4 flex items-center gap-3 rounded-[1.5rem] border border-white/70 bg-white/85 px-4 py-3 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.45)] backdrop-blur">
        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          onClick={() => goTo(currentIndex - 1)}
          disabled={currentIndex === 0 || isSubmitting}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <span className="ml-1 text-xs font-medium text-slate-500">
          Step {currentIndex + 1} of {WIZARD_STEPS.length}
        </span>

        <span className="flex-1" />

        <Button
          type="button"
          variant="ghost"
          className="rounded-full text-slate-600"
          onClick={handleSaveDraft}
          disabled={isSubmitting || initializing}
        >
          Save &amp; exit as draft
        </Button>

        <Button
          type="button"
          className="rounded-full"
          onClick={handleNext}
          disabled={isSubmitting || (isReview && initializing)}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving
            </>
          ) : (
            <>
              {primaryLabel}
              {isReview ? null : <ArrowRight className="ml-2 h-4 w-4" />}
            </>
          )}
        </Button>
      </div>

      <p className="px-1 text-center text-xs text-slate-400">
        {organization?.name
          ? `Saving into ${organization.name}.`
          : initializing
            ? "Loading workspace…"
            : "No workspace found."}{" "}
        Progress is kept while this page is open; it is not autosaved.
      </p>
    </div>
  );
}
