"use client";

import type { UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import type { EmailEditorFormValues } from "@/features/emails/schemas";
import { cn } from "@/lib/utils";

interface EmailEditorModeToggleProps {
  form: UseFormReturn<EmailEditorFormValues>;
}

const MODE_OPTIONS: Array<{ value: "text" | "blocks"; label: string }> = [
  { value: "text", label: "Plain text" },
  { value: "blocks", label: "Visual editor" },
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
        Switch between quick copy edits and the visual canvas without losing
        your draft.
      </p>
    </div>
  );
}
