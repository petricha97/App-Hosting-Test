"use client";

// Plain text / Block designer segmented control (design §2) — a 2-option
// copy of the event-page-editor-workspace.tsx device-preview toggle's
// `role="group"` + `aria-pressed` pattern, NOT a second nested `Tabs`
// instance (the dialog already uses Tabs one level up for Compose/History —
// nesting a second Tabs here would read as another top-level tab, not a
// sub-mode of Compose).
//
// LOAD-BEARING detail (spec §4 AC-3 / design §2 "Dirty-tracking"): this
// writes `bodyMode` through the SAME RHF form instance as every other field
// via `form.setValue("bodyMode", next, { shouldDirty: true })` — never a
// parallel `useState`. The dialog's existing `attemptClose()` reads
// `form.formState.isDirty` synchronously during render (the QA-D-1 fix from
// M6-T2), so routing the toggle through RHF makes mode-only switches trip
// the unsaved-changes guard for free, with no second dirty-tracking path to
// get wrong.
import type { UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import type { EmailEditorFormValues } from "@/features/emails/schemas";
import { cn } from "@/lib/utils";

interface EmailEditorModeToggleProps {
  form: UseFormReturn<EmailEditorFormValues>;
}

const MODE_OPTIONS: Array<{ value: "text" | "blocks"; label: string }> = [
  { value: "text", label: "Plain text" },
  { value: "blocks", label: "Block designer" },
];

export function EmailEditorModeToggle({ form }: EmailEditorModeToggleProps) {
  const mode = form.watch("bodyMode");

  return (
    <div className="space-y-1.5">
      <div
        role="group"
        aria-label="Email content mode"
        className="inline-flex rounded-lg border border-border p-0.5"
      >
        {MODE_OPTIONS.map((option) => {
          const active = mode === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={active}
              className={cn(
                "rounded-md",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() =>
                form.setValue("bodyMode", option.value, {
                  shouldDirty: true,
                })
              }
            >
              {option.label}
            </Button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Switching modes doesn&apos;t delete your work — only the mode you save
        in becomes the live email.
      </p>
    </div>
  );
}
