"use client";

// Expanded row detail (design §5): the frozen snapshot via
// email-preview-frame.tsx (read-only, same component) + providerMessageId +
// lastError.message rendered as PLAIN TEXT (never HTML-interpreted),
// line-clamped with a "Show more" expand (§5 AC-7 — full text always in the
// DOM for assistive tech).
import { useState } from "react";

import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EmailPreviewFrame } from "@/features/emails/components/email-preview-frame";
import type { SerializedEmailMessage } from "@/features/emails/types";

interface SendLogRowDetailProps {
  message: SerializedEmailMessage;
  colSpan: number;
  rowId: string;
}

export function SendLogRowDetail({
  message,
  colSpan,
  rowId,
}: SendLogRowDetailProps) {
  const [expandedError, setExpandedError] = useState(false);

  return (
    <TableRow id={rowId} className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={colSpan} className="space-y-3 py-4">
        <EmailPreviewFrame
          subject={message.subject}
          bodyHtml={message.bodyHtml}
        />

        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Provider message id</dt>
            <dd className="font-mono">{message.providerMessageId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Attempts</dt>
            <dd className="tabular-nums">{message.attemptCount}</dd>
          </div>
        </dl>

        {message.lastError ? (
          <div className="text-xs">
            <p className="text-muted-foreground">Last error</p>
            {/* plain text only — never dangerouslySetInnerHTML (§5 AC-7) */}
            <p className={expandedError ? undefined : "line-clamp-2"}>
              {message.lastError.message}
            </p>
            {message.lastError.message.length > 120 ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => setExpandedError((current) => !current)}
              >
                {expandedError ? "Show less" : "Show more"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
