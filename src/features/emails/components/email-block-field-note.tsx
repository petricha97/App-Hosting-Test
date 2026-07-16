"use client";

// Shared synthetic-field note (design §4) — icon + static text, reused two
// ways: (1) as the `type: "custom"` throwaway-prop field appended to a
// block's field panel (the per-block divergence notes, design §4's table),
// and (2) as the empty-canvas warning banner (design §5). `variant="note"`
// (default) is the inline field-panel footnote shape; `variant="banner"` is
// the bordered-box shape used for the empty-canvas warning. `tone` picks the
// neutral (info) vs. amber (warning) treatment — the field-panel notes are
// always neutral (they document a real, working divergence, not a problem
// to fix); only the empty-canvas warning uses `tone="warning"`, matching the
// EXACT amber convention already contrast-verified elsewhere in this app
// (e.g. apply-to-events-dialog.tsx's AlertTriangle banner).
import { AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmailBlockFieldNoteProps {
  children: ReactNode;
  tone?: "neutral" | "warning";
  variant?: "note" | "banner";
  className?: string;
}

export function EmailBlockFieldNote({
  children,
  tone = "neutral",
  variant = "note",
  className,
}: EmailBlockFieldNoteProps) {
  const Icon = tone === "warning" ? AlertTriangle : Info;

  if (variant === "banner") {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
          tone === "warning"
            ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
            : "border-border bg-muted/50",
          className,
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            tone === "warning"
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground",
          )}
        />
        <span
          className={
            tone === "warning"
              ? "text-amber-900 dark:text-amber-200"
              : "text-foreground"
          }
        >
          {children}
        </span>
      </div>
    );
  }

  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs",
        tone === "warning"
          ? "text-amber-700 dark:text-amber-400"
          : "text-muted-foreground",
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
