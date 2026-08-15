"use client";

// CREATE wizard — Step 4 ("Public page", optional).
// Thin wrapper around the SHARED public-page field group (mode chooser +
// conditional redirect URL). Shared with the edit workspace. See
// src/features/event/fields/event-public-page-fields.tsx.

import type { UseFormReturn } from "react-hook-form";

import type { EventFormInput, EventFormValues } from "@/features/event/schema";
import { EventPublicPageFields } from "@/features/event/fields/event-public-page-fields";

interface StepPublicPageProps {
  form: UseFormReturn<EventFormInput, undefined, EventFormValues>;
}

/** Renders the shared "Public page" field group inside the wizard's Step 4. */
export function StepPublicPage({ form }: StepPublicPageProps) {
  return <EventPublicPageFields form={form} />;
}
