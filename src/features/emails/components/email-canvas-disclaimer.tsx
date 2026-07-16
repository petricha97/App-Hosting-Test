"use client";

// Persistent, non-dismissable "canvas is approximate" banner (design §3.3).
// Deliberately NEUTRAL toned (bg-muted/50, Info icon) — the same treatment
// already used twice in this dialog family (the "This email is off" banner
// in email-editor-dialog.tsx, the "inherits the default page" banner in
// event-page-editor-workspace.tsx) — never amber, so organizers don't learn
// to associate "amber = nothing's actually wrong" from a banner that's on
// every single visit. The amber treatment stays reserved for genuine
// warnings (EmailPreviewFrame's unknown-tag rows, the empty-canvas warning).
import { useState } from "react";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";

const WHATS_DIFFERENT_ITEMS = [
  "No side-by-side layouts — every block stacks in a single column in the real email.",
  "Hero's button labels aren't clickable in email and won't appear — see the note on that field below.",
  "Call to Action isn't available here — it has no real destination. Use Registration Embed instead.",
  "Countdown timer shows a fixed date, not ticking digits.",
];

export function EmailCanvasDisclaimer() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Info
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-muted-foreground"
        />
        <span className="text-foreground">
          Canvas preview is approximate — email clients render differently.
        </span>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          What&apos;s different? {expanded ? "▴" : "▾"}
        </Button>
      </div>
      {expanded ? (
        <ul className="mt-2 list-disc space-y-1 pl-9 text-xs text-muted-foreground">
          {WHATS_DIFFERENT_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
