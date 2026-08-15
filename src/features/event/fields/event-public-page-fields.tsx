"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED FIELD GROUP — "Public page"
// ─────────────────────────────────────────────────────────────────────────────
// Renders the public-page mode chooser (default / custom / redirect) and the
// conditional redirect URL. SINGLE source of truth, rendered by BOTH screens:
//   • CREATE  → create-event-wizard.tsx  (Step 4, via step-public-page.tsx)
//   • EDIT    → create-event-workspace.tsx (inside the "Event basics" card)
//
// The redirect URL only appears (and is only required) when mode === "redirect";
// that requirement is also enforced server-side by eventFormSchema's superRefine.
// ─────────────────────────────────────────────────────────────────────────────

import type { UseFormReturn } from "react-hook-form";

import { cn } from "@/lib/utils";
import type { EventFormInput, EventFormValues } from "@/features/event/schema";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// The three page modes match eventPageModeSchema. "custom" is a reserved
// "build later" placeholder — there is no builder yet.
const PAGE_MODES: Array<{
  value: EventFormValues["pageMode"];
  title: string;
  description: string;
}> = [
  {
    value: "default",
    title: "Use default event page",
    description: "We generate a clean page from your event details.",
  },
  {
    value: "custom",
    title: "Design a custom page later",
    description:
      "Reserve a custom page for this event and build it after creation.",
  },
  {
    value: "redirect",
    title: "Redirect to my own page",
    description: "Send visitors to a page you host elsewhere.",
  },
];

interface EventPublicPageFieldsProps {
  /** The shared react-hook-form instance from the parent screen. */
  form: UseFormReturn<EventFormInput, undefined, EventFormValues>;
}

/** Renders the public-page mode chooser and the redirect URL (only when the
 *  redirect mode is selected). Shared by the create wizard and edit workspace. */
export function EventPublicPageFields({ form }: EventPublicPageFieldsProps) {
  const pageMode = form.watch("pageMode");

  return (
    <div className="space-y-5">
      <FormField
        control={form.control}
        name="pageMode"
        render={({ field }) => (
          <FormItem>
            <FormLabel>How should your public page work?</FormLabel>
            <FormControl>
              <RadioGroup
                value={field.value ?? "default"}
                onValueChange={field.onChange}
                className="gap-3"
              >
                {PAGE_MODES.map((mode) => {
                  const selected = field.value === mode.value;
                  return (
                    <FormLabel
                      key={mode.value}
                      htmlFor={`pageMode-${mode.value}`}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition",
                        selected
                          ? "border-orange-400 bg-orange-50"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300",
                      )}
                    >
                      <RadioGroupItem
                        id={`pageMode-${mode.value}`}
                        value={mode.value}
                        className="mt-0.5"
                      />
                      <span className="space-y-1">
                        <span className="block text-sm font-semibold text-slate-950">
                          {mode.title}
                        </span>
                        <span className="block text-xs leading-5 text-slate-600">
                          {mode.description}
                        </span>
                      </span>
                    </FormLabel>
                  );
                })}
              </RadioGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Only shown when the redirect mode is selected. */}
      {pageMode === "redirect" ? (
        <FormField
          control={form.control}
          name="redirectUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Redirect URL</FormLabel>
              <FormControl>
                <Input
                  type="url"
                  placeholder="https://example.com/my-event"
                  className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Required when you redirect to your own page.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </div>
  );
}
