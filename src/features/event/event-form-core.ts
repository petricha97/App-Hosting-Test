import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { serverTimestamp } from "firebase/firestore";
import { toast } from "sonner";

import { createEvent } from "@/lib/db/event";
import { buildOrganizationEventPath } from "@/features/event/utils";
import type {
  EventFormInput,
  EventFormValues,
  EventRegistrationPeriodValues,
  EventScheduleRangeValues,
} from "@/features/event/schema";

/**
 * Shared, side-effect-free building blocks for the create-event experience.
 *
 * Both `CreateEventWorkspace` (single-page create + edit) and
 * `CreateEventWizard` (stepped create) consume these so the React Hook Form
 * defaults and the submit "brain" live in exactly one place. No behavior
 * change relative to the original workspace implementation.
 */

export const PENDING_FORM_PATH = "Form/pending";

export const EMPTY_SCHEDULE_RANGE: EventScheduleRangeValues = {
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
};

/** A blank registration period whose dates default to today (times empty). */
export function buildEmptyRegistrationPeriod(
  todayDate: string,
): EventRegistrationPeriodValues {
  return {
    startDate: todayDate,
    startTime: "",
    endDate: todayDate,
    endTime: "",
  };
}

export type EventWorkspaceMode = "create" | "edit";

export interface EventWorkspaceInitialValues {
  name?: string;
  description?: string;
  capacity?: number;
  expectedGuests?: number;
  formPath?: string;
  invoicePath?: string;
  organizationPath?: string;
  timezone?: string;
  allowOverlap?: boolean;
  status?: "Draft" | "Published";
  pageMode?: "default" | "custom" | "redirect";
  redirectUrl?: string;
  registrationPeriod?: Partial<EventRegistrationPeriodValues>;
  periods?: Array<Partial<EventScheduleRangeValues>>;
}

/** Firestore path for the active org's events collection, or "" if no org yet. */
export function buildOrganizationPath(organizationId: string | null): string {
  return organizationId ? buildOrganizationEventPath(organizationId) : "";
}

/** Coerce a stored period into the form's {startDate,startTime,endDate,endTime}
 *  shape, tolerating the older `{date, start_time, end_time}` document format. */
export function normalizeScheduleRange(
  value: Partial<EventScheduleRangeValues> | Record<string, string> | undefined,
): EventScheduleRangeValues {
  const recordValue = value as Record<string, string> | undefined;

  return {
    startDate: value?.startDate ?? recordValue?.date ?? "",
    startTime: value?.startTime ?? recordValue?.start_time ?? "",
    endDate: value?.endDate ?? recordValue?.date ?? "",
    endTime: value?.endTime ?? recordValue?.end_time ?? "",
  };
}

/** Build the react-hook-form default values. With no `initialValues` (create)
 *  it returns a blank-but-valid form; with them (edit) it hydrates from the
 *  existing event document. */
export function buildWorkspaceDefaults(
  organizationPathDefault: string,
  todayDateString: string,
  initialValues?: EventWorkspaceInitialValues,
): EventFormInput {
  const registrationPeriod = initialValues?.registrationPeriod;

  return {
    name: initialValues?.name ?? "",
    description: initialValues?.description ?? "",
    capacity: initialValues?.capacity ?? 1,
    expectedGuests: initialValues?.expectedGuests ?? 0,
    formPath: initialValues?.formPath ?? PENDING_FORM_PATH,
    invoicePath: initialValues?.invoicePath ?? "",
    organizationPath:
      initialValues?.organizationPath ?? organizationPathDefault,
    timezone: initialValues?.timezone ?? "Asia/Singapore",
    allowOverlap: initialValues?.allowOverlap ?? false,
    status: initialValues?.status ?? "Draft",
    pageMode: initialValues?.pageMode ?? "default",
    redirectUrl: initialValues?.redirectUrl ?? "",
    registrationPeriod: {
      startDate: registrationPeriod?.startDate ?? todayDateString,
      startTime: registrationPeriod?.startTime ?? "",
      endDate: registrationPeriod?.endDate ?? todayDateString,
      endTime: registrationPeriod?.endTime ?? "",
    },
    periods:
      initialValues?.periods && initialValues.periods.length > 0
        ? initialValues.periods.map((period) => normalizeScheduleRange(period))
        : [{ ...EMPTY_SCHEDULE_RANGE }],
  };
}

export interface SubmitEventFormArgs {
  mode: EventWorkspaceMode;
  eventId?: string;
  values: EventFormValues;
  router: Pick<AppRouterInstance, "push" | "refresh">;
}

/**
 * The exact submit logic that used to live inside the workspace `onSubmit`.
 * Kept verbatim so create (workspace + wizard) and edit all behave identically.
 */
export async function submitEventForm({
  mode,
  eventId,
  values,
  router,
}: SubmitEventFormArgs): Promise<void> {
  try {
    if (mode === "edit" && eventId) {
      const response = await fetch(`/api/dashboard/events/${eventId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Unable to update the event.",
        );
      }

      toast.success("Event updated", {
        description:
          values.pageMode === "redirect"
            ? "The public page settings were updated for this event."
            : "The event details have been saved.",
      });

      router.push(`/dashboard/events/${eventId}`);
      router.refresh();
    } else {
      const id = await createEvent({
        ...values,
        createdAt: serverTimestamp() as never,
        updatedAt: serverTimestamp() as never,
        periods: values.periods,
      });

      toast.success(
        values.status === "Published"
          ? "Event published"
          : "Draft event created",
        {
          description:
            values.status === "Published"
              ? "The event has been saved and can now appear in the public events list."
              : "The event has been saved. Opening the event workspace now.",
        },
      );

      router.push(`/dashboard/events/${id}`);
      router.refresh();
    }
  } catch (error) {
    console.error(error);
    toast.error(
      mode === "edit" ? "Failed to update event" : "Failed to create event",
      {
        description:
          error instanceof Error
            ? error.message
            : "Please review the fields and try again.",
      },
    );
  }
}
