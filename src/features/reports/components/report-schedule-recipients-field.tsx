"use client";

// Recipient-entry control for the M7-T3 schedule form (spec §2): a
// free-text email input + "+ Add" action (never a roster picker — D2, this
// codebase has no "list all org members" query) with a running chip list.
// Accepts comma/newline/whitespace-separated paste of multiple addresses in
// one go. Client-side validation is a BASIC email-format check only — the
// server independently re-verifies org membership per candidate on submit
// (D2) and can reject any chip individually; a rejected chip renders in a
// distinct error state with the server's own reason text (never a generic
// "something went wrong").
import { useId, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_RECIPIENTS_PER_SCHEDULE_CLIENT,
  reportScheduleRecipientEmailSchema,
} from "@/features/reports/schedule-schemas";

export interface RecipientChip {
  email: string;
  // Set when the server rejected this exact email on the last submit
  // attempt (D2 AC-2) — cleared as soon as the chip list changes again.
  error?: string;
}

interface ReportScheduleRecipientsFieldProps {
  recipients: RecipientChip[];
  onChange: (next: RecipientChip[]) => void;
  currentUserEmail: string;
  disabled?: boolean;
}

function splitCandidates(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function ReportScheduleRecipientsField({
  recipients,
  onChange,
  currentUserEmail,
  disabled = false,
}: ReportScheduleRecipientsFieldProps) {
  const [inputValue, setInputValue] = useState("");
  const [formatError, setFormatError] = useState<string | null>(null);
  const inputId = useId();

  const atCap = recipients.length >= MAX_RECIPIENTS_PER_SCHEDULE_CLIENT;

  const addCandidates = (raw: string) => {
    const candidates = splitCandidates(raw);
    if (candidates.length === 0) return;

    const existing = new Set(recipients.map((r) => r.email));
    const toAdd: RecipientChip[] = [];
    let firstError: string | null = null;

    for (const candidate of candidates) {
      const parsed = reportScheduleRecipientEmailSchema.safeParse(candidate);
      if (!parsed.success) {
        firstError ??= `"${candidate}" isn't a valid email address.`;
        continue;
      }
      if (
        existing.has(parsed.data) ||
        toAdd.some((c) => c.email === parsed.data)
      ) {
        continue; // silent dedupe — already on the list
      }
      if (
        recipients.length + toAdd.length >=
        MAX_RECIPIENTS_PER_SCHEDULE_CLIENT
      ) {
        firstError ??= `A schedule can have at most ${MAX_RECIPIENTS_PER_SCHEDULE_CLIENT} recipients.`;
        break;
      }
      toAdd.push({ email: parsed.data });
    }

    if (toAdd.length > 0) {
      onChange([...recipients, ...toAdd]);
    }
    setFormatError(firstError);
    setInputValue("");
  };

  const handleAddClick = () => addCandidates(inputValue);

  const handleAddMyself = () => {
    if (!currentUserEmail) return;
    addCandidates(currentUserEmail);
  };

  const alreadyIncludesSelf = recipients.some(
    (r) => r.email === currentUserEmail.toLowerCase(),
  );

  const removeRecipient = (email: string) => {
    onChange(recipients.filter((r) => r.email !== email));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <Textarea
          id={inputId}
          placeholder="name@company.com"
          value={inputValue}
          disabled={disabled || atCap}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            // Plain Enter inserts a newline (so pasting/typing several
            // addresses one per line works) — Cmd/Ctrl+Enter is the
            // keyboard shortcut for "+ Add" (the click handler below).
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              handleAddClick();
            }
          }}
          rows={2}
          className="max-w-xs"
        />
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || atCap || !inputValue.trim()}
            onClick={handleAddClick}
          >
            + Add
          </Button>
          {currentUserEmail && !alreadyIncludesSelf ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || atCap}
              onClick={handleAddMyself}
            >
              Add myself
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Separate multiple addresses with a comma or a new line.
      </p>

      {formatError ? (
        <p className="text-sm text-destructive">{formatError}</p>
      ) : null}

      {recipients.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recipients yet — add at least one verified org member.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Recipients">
          {recipients.map((recipient) => (
            <li
              key={recipient.email}
              className={
                recipient.error
                  ? "flex flex-col gap-0.5 rounded-md border border-destructive bg-destructive/10 px-2 py-1"
                  : "flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1"
              }
            >
              <div className="flex items-center gap-1">
                <span className="text-sm">{recipient.email}</span>
                <button
                  type="button"
                  aria-label={`Remove ${recipient.email}`}
                  disabled={disabled}
                  onClick={() => removeRecipient(recipient.email)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </div>
              {recipient.error ? (
                <span className="text-xs text-destructive">
                  {recipient.error}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        {recipients.length}/{MAX_RECIPIENTS_PER_SCHEDULE_CLIENT} recipients.
        Only current members of your organization can be added — the server
        verifies each address.
      </p>
    </div>
  );
}
