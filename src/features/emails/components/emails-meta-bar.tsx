"use client";

// Sender and merge-tag context card for the event email workspace.
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  EmailComposerTokenSection,
  SerializedEmailSettings,
} from "@/features/emails/types";

interface EmailsMetaBarProps {
  settings: SerializedEmailSettings;
  tokenSections: EmailComposerTokenSection[];
  onOpenSenderSettings: () => void;
}

export function EmailsMetaBar({
  settings,
  tokenSections,
  onOpenSenderSettings,
}: EmailsMetaBarProps) {
  const quickTokens = tokenSections
    .flatMap((section) => section.items.slice(0, section.id === "recipient" ? 2 : 1))
    .slice(0, 4);

  return (
    <Card className="rounded-2xl py-0">
      <CardContent className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="space-y-2 text-sm">
          <p className="font-medium text-foreground">Sender</p>
          <Button
            variant="outline"
            className="justify-start font-mono text-xs sm:text-sm"
            onClick={onOpenSenderSettings}
          >
            {settings.fromName} &lt;{settings.fromAddress}&gt;
          </Button>
        </div>

        <div className="space-y-2 text-xs">
          <p className="text-sm text-muted-foreground">
            Personalize with recipient, event, and organization fields.
          </p>
          <div className="flex flex-wrap gap-2">
            {quickTokens.map((item) => (
              <span
                key={item.token}
                className="rounded-full border bg-muted/40 px-2.5 py-1 font-mono"
                title={item.previewValue?.trim() || item.hint}
              >
                {item.token}
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
