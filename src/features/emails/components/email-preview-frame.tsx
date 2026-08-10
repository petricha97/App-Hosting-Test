"use client";

import { Loader2 } from "lucide-react";

interface EmailPreviewFrameProps {
  subject: string;
  bodyHtml: string;
  missingTags?: string[];
  unknownTags?: string[];
  unknownVariables?: string[];
  loading?: boolean;
  error?: string | null;
  className?: string;
}

export function EmailPreviewFrame({
  subject,
  bodyHtml,
  missingTags = [],
  unknownTags = [],
  unknownVariables = [],
  loading = false,
  error = null,
  className,
}: EmailPreviewFrameProps) {
  return (
    <div className={className}>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          Updating preview...
        </p>
      ) : (
        <p className="truncate text-xs text-muted-foreground" title={subject}>
          Subject: {subject || <span className="italic">(empty)</span>}
        </p>
      )}

      <iframe
        sandbox=""
        srcDoc={bodyHtml}
        title="Email preview"
        className="mt-2 h-72 w-full rounded-lg border border-border bg-white"
      />

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      {unknownVariables.length > 0 ||
      unknownTags.length > 0 ||
      missingTags.length > 0 ? (
        <div className="mt-2 space-y-1">
          {unknownVariables.map((key) => (
            <p key={key} className="text-xs text-amber-700 dark:text-amber-400">
              Unknown variable <span className="font-mono">{`{{${key}}}`}</span>{" "}
              - choose a listed field or check spelling
            </p>
          ))}
          {unknownTags.map((tag) => (
            <p key={tag} className="text-xs text-amber-700 dark:text-amber-400">
              Unknown tag <span className="font-mono">{`{${tag}}`}</span> -
              check spelling
            </p>
          ))}
          {missingTags.map((tag) => (
            <p key={tag} className="text-xs text-muted-foreground">
              <span className="font-mono">{`{${tag}}`}</span> renders blank for
              this recipient
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
