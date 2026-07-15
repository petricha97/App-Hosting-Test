"use client";

// Shared render surface for the editor preview (§3), the confirmation card
// (§4) and the send-log row detail (§5) — "one preview implementation, not
// two". Subject line + a SANDBOXED iframe (sandbox="", no scripts) with the
// server-derived bodyHtml as srcDoc, plus the unknown/missing-tag warning
// rows. The `<script>` XSS case is guaranteed by construction upstream
// (src/features/emails/server/render.ts HTML-escapes the template before
// merge-tag substitution) — sandbox="" is defense-in-depth for the M6-T4
// future, not "the" fix (design §3 note).
import { Loader2 } from "lucide-react";

interface EmailPreviewFrameProps {
  subject: string;
  bodyHtml: string;
  missingTags?: string[];
  unknownTags?: string[];
  loading?: boolean;
  error?: string | null;
  className?: string;
}

export function EmailPreviewFrame({
  subject,
  bodyHtml,
  missingTags = [],
  unknownTags = [],
  loading = false,
  error = null,
  className,
}: EmailPreviewFrameProps) {
  return (
    <div className={className}>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          Updating preview…
        </p>
      ) : (
        <p className="truncate text-xs text-muted-foreground" title={subject}>
          Subject: {subject || <span className="italic">(empty)</span>}
        </p>
      )}

      {/* Deliberately NOT theme-following — emails render the same for every
          recipient (design §8-1); only the bordered container follows the
          app theme. */}
      <iframe
        sandbox=""
        srcDoc={bodyHtml}
        title="Email preview"
        className="mt-2 h-72 w-full rounded-lg border border-border bg-white"
      />

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      {unknownTags.length > 0 || missingTags.length > 0 ? (
        <div className="mt-2 space-y-1">
          {unknownTags.map((tag) => (
            <p key={tag} className="text-xs text-amber-700 dark:text-amber-400">
              Unknown tag <span className="font-mono">{`{${tag}}`}</span> —
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
