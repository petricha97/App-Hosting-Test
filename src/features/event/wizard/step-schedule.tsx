"use client";

// CREATE wizard — Step 2 ("Date & time").
// Thin wrapper around the SHARED schedule field group (registration window +
// event date ranges + timezone + allow-overlap). Shared with the edit
// workspace. See src/features/event/fields/event-schedule-fields.tsx.

import type { UseFormReturn } from "react-hook-form";

import type { EventFormInput, EventFormValues } from "@/features/event/schema";
import { EventScheduleFields } from "@/features/event/fields/event-schedule-fields";

interface StepScheduleProps {
  form: UseFormReturn<EventFormInput, undefined, EventFormValues>;
  todayDateString: string;
}

/** Renders the shared "Date & time" field group inside the wizard's Step 2. */
export function StepSchedule({ form, todayDateString }: StepScheduleProps) {
  return <EventScheduleFields form={form} todayDateString={todayDateString} />;
}
