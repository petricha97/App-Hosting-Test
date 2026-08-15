"use client";

// CREATE wizard — Step 1 ("Event details").
// Thin wrapper: the actual inputs live in the SHARED field group so the create
// wizard and the edit workspace render identical fields. See
// src/features/event/fields/event-basics-fields.tsx.

import type { UseFormReturn } from "react-hook-form";

import type { EventFormInput, EventFormValues } from "@/features/event/schema";
import { EventBasicsFields } from "@/features/event/fields/event-basics-fields";

interface StepBasicsProps {
  form: UseFormReturn<EventFormInput, undefined, EventFormValues>;
}

/** Renders the shared "Event basics" field group inside the wizard's Step 1. */
export function StepBasics({ form }: StepBasicsProps) {
  return <EventBasicsFields form={form} />;
}
