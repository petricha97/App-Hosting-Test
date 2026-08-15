"use client";

// ─────────────────────────────────────────────────────────────────────────────
// EDIT screen — single-page event form.
// ─────────────────────────────────────────────────────────────────────────────
// This is the flat, scroll-through form used to EDIT an existing event
// (rendered by src/app/dashboard/(event)/events/[eventId]/edit/page.tsx with
// mode="edit"). Editors want to jump straight to a field, so this stays a single
// page rather than a wizard.
//
// CREATING a new event now uses the step-by-step wizard instead
// (src/features/event/create-event-wizard.tsx). This component still technically
// supports mode="create", but the create route no longer renders it that way.
//
// The actual field markup is NOT defined here — it comes from the SHARED field
// groups in src/features/event/fields/*, which the create wizard renders too, so
// there is one source of truth per field group. This file only arranges those
// groups on one page and adds the EDIT-only bits (status <select>, dev-only
// linkage paths, and the right-hand context panel).
// Save logic (create + edit) lives in event-form-core.ts → submitEventForm.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CalendarClock,
  FileStack,
  Globe,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useForm } from "react-hook-form";

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
  type EventWorkspaceInitialValues,
  type EventWorkspaceMode,
} from "@/features/event/event-form-core";
// Shared field groups — the SAME components the create wizard renders.
import { EventBasicsFields } from "@/features/event/fields/event-basics-fields";
import { EventScheduleFields } from "@/features/event/fields/event-schedule-fields";
import { EventPublicPageFields } from "@/features/event/fields/event-public-page-fields";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const FORM_ID = "create-event-form";

interface CreateEventWorkspaceProps {
  mode?: EventWorkspaceMode;
  eventId?: string;
  initialValues?: EventWorkspaceInitialValues;
}

export function CreateEventWorkspace({
  mode = "create",
  eventId,
  initialValues,
}: CreateEventWorkspaceProps) {
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
    () =>
      buildWorkspaceDefaults(
        organizationPathDefault,
        todayDateString,
        initialValues,
      ),
    [initialValues, organizationPathDefault, todayDateString],
  );

  const form = useForm<EventFormInput, undefined, EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues,
  });

  // Keep organizationPath filled from the active workspace unless the user has
  // touched it.
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

  // On create, formPath stays the system-managed placeholder until the form
  // builder saves its first draft.
  useEffect(() => {
    const currentFormPath = form.getValues("formPath");

    if (mode === "create" && currentFormPath !== PENDING_FORM_PATH) {
      form.setValue("formPath", PENDING_FORM_PATH, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [form, mode]);

  // Delegates to the shared submit logic (identical for create + edit).
  async function onSubmit(values: EventFormValues) {
    await submitEventForm({ mode, eventId, values, router });
  }

  const isSubmitting = form.formState.isSubmitting;
  const selectedStatus = form.watch("status");
  const isEditing = mode === "edit";

  const submitHeading =
    isEditing && selectedStatus === "Published"
      ? "Update published event"
      : isEditing
        ? "Save event changes"
        : selectedStatus === "Published"
          ? "Publish event"
          : "Save draft";
  const secondarySubmitLabel =
    isEditing && selectedStatus === "Published"
      ? "Update published event"
      : isEditing
        ? "Save changes"
        : selectedStatus === "Published"
          ? "Create published event"
          : "Create event now";

  const headerTitle = isEditing
    ? `Update ${form.watch("name") || "this event"} from the dashboard workspace.`
    : selectedStatus === "Published"
      ? "Create and publish an event from the dashboard workspace."
      : "Create a real draft event from the new dashboard workspace.";
  const headerDescription = isEditing
    ? "Adjust the public page mode, redirect behavior, registration window, and other event details without leaving the dashboard."
    : selectedStatus === "Published"
      ? "Published events can appear in the public events directory as soon as they are saved."
      : "This route now saves to Firestore using the existing event helper, while keeping the calmer dashboard-first layout we already scaffolded.";

  const topButtonLabel = isSubmitting
    ? isEditing
      ? "Saving changes"
      : selectedStatus === "Published"
        ? "Publishing event"
        : "Saving draft"
    : submitHeading;

  const sideButtonLabel = isSubmitting
    ? isEditing
      ? "Saving..."
      : selectedStatus === "Published"
        ? "Publishing..."
        : "Saving..."
    : secondarySubmitLabel;

  const backHref =
    isEditing && eventId ? `/dashboard/events/${eventId}` : "/dashboard/events";

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow={isEditing ? "Edit event" : "Create event"}
        title={headerTitle}
        description={headerDescription}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={backHref}>
                {isEditing ? "Back to Event" : "Back to Events"}
              </Link>
            </Button>
            <Button type="submit" form={FORM_ID} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {topButtonLabel}
                </>
              ) : (
                submitHeading
              )}
            </Button>
          </>
        }
      />

      <section className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <Form {...form}>
          <form
            id={FORM_ID}
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6"
          >
            {/* ── Event basics + public page (shared field groups) ────────── */}
            <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
              <CardHeader className="px-6 pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl text-slate-950">
                      Event basics
                    </CardTitle>
                    <CardDescription className="mt-2 text-sm leading-7 text-slate-600">
                      Start with the essential event details before moving into
                      form design and responses.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 px-6 pb-6 pt-0">
                <EventBasicsFields form={form} />
                <EventPublicPageFields form={form} />
              </CardContent>
            </Card>

            {/* ── Schedule (shared) + EDIT-only status select ─────────────── */}
            <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
              <CardHeader className="px-6 pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl text-slate-950">
                      Schedule and timing
                    </CardTitle>
                    <CardDescription className="mt-2 text-sm leading-7 text-slate-600">
                      Add one or more date and time ranges. This supports
                      schedules like Thursday and Friday, skipping the weekend,
                      then continuing on Monday and Tuesday.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 px-6 pb-6 pt-0">
                <EventScheduleFields
                  form={form}
                  todayDateString={todayDateString}
                />

                {/* EDIT-only: publish status. In CREATE this Draft/Publish
                    choice lives on the wizard's Review step instead. */}
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <FormControl>
                        <select
                          className="flex h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm shadow-sm outline-none transition focus:border-orange-300"
                          value={field.value}
                          onChange={field.onChange}
                        >
                          <option value="Draft">Draft</option>
                          <option value="Published">Published</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* ── Dev-only linkage paths (system-managed, read-only) ───────── */}
            <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
              <CardHeader className="px-6 pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                    <FileStack className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <CardTitle className="text-2xl text-slate-950">
                        Registration and billing paths
                      </CardTitle>
                      <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-900">
                        Dev only
                      </span>
                    </div>
                    <CardDescription className="mt-2 text-sm leading-7 text-slate-600">
                      These legacy linkage values still exist in the event
                      document for development compatibility. They should be
                      removed once the model is cleaned up.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 px-6 pb-6 pt-0">
                <FormField
                  control={form.control}
                  name="formPath"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Form path</FormLabel>
                      <FormControl>
                        <Input
                          className="h-12 rounded-2xl border-slate-200 bg-slate-100 text-slate-600"
                          readOnly
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        This stays system-managed for now. It will be replaced
                        with the real `Form/&lt;id&gt;` link after the builder
                        saves its first draft.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="organizationPath"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Organization path</FormLabel>
                      <FormControl>
                        <Input
                          className="h-12 rounded-2xl border-slate-200 bg-slate-100 text-slate-600"
                          readOnly
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        This is filled from the active workspace and cannot be
                        edited here.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </form>
        </Form>

        {/* ── Right-hand context panel (EDIT-screen chrome) ───────────────── */}
        <div className="space-y-6">
          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
                    Workspace context
                  </CardDescription>
                  <CardTitle className="mt-2 text-2xl text-slate-950">
                    Save into the current organization
                  </CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0 text-sm leading-7 text-slate-600">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4">
                <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Active workspace
                </span>
                <p className="mt-2 text-base font-semibold text-slate-950">
                  {organization?.name ??
                    (initializing
                      ? "Loading workspace..."
                      : "No workspace found")}
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4">
                <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Organization path
                </span>
                <p className="mt-2 break-all text-sm text-slate-700">
                  {form.watch("organizationPath") || "Not set yet"}
                </p>
              </div>

              <p>
                {isEditing
                  ? "Saving here updates the real event document, including the public page mode and registration window."
                  : "The event is saved with timestamp fields, then routed into its dedicated event workspace for the next setup step."}
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-slate-950 py-0 text-white shadow-[0_24px_60px_-42px_rgba(15,23,42,0.55)]">
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-2xl">What happens next</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0 text-sm leading-7 text-slate-200">
              <p>
                {isEditing
                  ? "Once saved, the event overview will reflect the updated page settings, registration period, and scheduling rules."
                  : "After save, we take the user straight into the event overview so the next steps can become form design, responses, or publishing."}
              </p>
              <Button
                type="submit"
                form={FORM_ID}
                disabled={isSubmitting}
                className="rounded-full bg-white text-slate-950 hover:bg-orange-50"
              >
                {sideButtonLabel}
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
