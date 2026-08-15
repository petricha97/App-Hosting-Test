"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED FIELD GROUP — "Event basics"
// ─────────────────────────────────────────────────────────────────────────────
// Renders the four core event inputs: name, description, capacity, expected
// guests. It is the SINGLE source of truth for these fields and is rendered by
// BOTH event screens:
//   • CREATE  → src/features/event/create-event-wizard.tsx  (Step 1, via step-basics.tsx)
//   • EDIT    → src/features/event/create-event-workspace.tsx (the "Event basics" card)
// Keep it presentational: it only reads/writes the shared react-hook-form
// instance passed in. No data loading, no submit logic.
// ─────────────────────────────────────────────────────────────────────────────

import type { UseFormReturn } from "react-hook-form";

import type { EventFormInput, EventFormValues } from "@/features/event/schema";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface EventBasicsFieldsProps {
  /** The shared react-hook-form instance from the parent screen. */
  form: UseFormReturn<EventFormInput, undefined, EventFormValues>;
}

/** Renders name, description, capacity and expected-guests inputs bound to the
 *  passed-in form. Shared by the create wizard and the edit workspace. */
export function EventBasicsFields({ form }: EventBasicsFieldsProps) {
  return (
    <div className="space-y-5">
      {/* Event name (required) */}
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Event name</FormLabel>
            <FormControl>
              <Input
                placeholder="Product Summit 2026"
                className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Description (required) — shown on the public event page */}
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea
                placeholder="What is this event about?"
                className="min-h-32 rounded-[1.5rem] border-slate-200 bg-slate-50"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Capacity + Expected guests. These are numeric; we mirror the value as a
          string so an empty input shows "" instead of 0, and let Zod coerce it
          back to a number on submit. */}
      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={form.control}
          name="capacity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Capacity</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={field.value === undefined ? "" : String(field.value)}
                  onChange={(event) => field.onChange(event.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="expectedGuests"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Expected guests</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={field.value === undefined ? "" : String(field.value)}
                  onChange={(event) => field.onChange(event.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
