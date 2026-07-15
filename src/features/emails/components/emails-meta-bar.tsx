"use client";

// Meta line under the header (design §0) — resolved from-address (opens
// Sender settings) + merge-tag examples.
import { Button } from "@/components/ui/button";
import type { SerializedEmailSettings } from "@/features/emails/types";

interface EmailsMetaBarProps {
  settings: SerializedEmailSettings;
  onOpenSenderSettings: () => void;
}

export function EmailsMetaBar({
  settings,
  onOpenSenderSettings,
}: EmailsMetaBarProps) {
  return (
    <p className="text-sm text-muted-foreground">
      Lifecycle-triggered messages. From{" "}
      <Button
        variant="link"
        className="h-auto p-0 text-sm font-mono"
        onClick={onOpenSenderSettings}
      >
        {settings.fromName} &lt;{settings.fromAddress}&gt;
      </Button>{" "}
      · merge tags like{" "}
      <span className="font-mono text-xs">{"{event_title}"}</span>,{" "}
      <span className="font-mono text-xs">{"{first_name}"}</span>.
    </p>
  );
}
