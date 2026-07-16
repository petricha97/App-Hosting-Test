"use client";

// "Insert merge tag" dropdown (design §3) — lists all 14 T1 catalog tags
// with human labels + source hints; selecting inserts `{tag}` at the
// tracked cursor position and refocuses with the cursor placed after the
// inserted tag.
//
// M6-T4 (design §3.4): generalized `textareaRef` to accept
// `HTMLInputElement | HTMLTextAreaElement` (not forked into a second
// component) so the SAME menu can be reused, scoped to whichever Puck block
// field currently has focus, inside the block designer — not just the
// dialog's single plain-text Body textarea. Added an optional `disabled`
// prop for the block-designer's "no field focused yet" state (design §3.4:
// disabled-with-tooltip, the same convention already used app-wide).
import type { RefObject } from "react";
import { Braces } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EMAIL_MERGE_TAG_DISPLAY } from "@/features/emails/utils";

interface MergeTagMenuProps {
  textareaRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

export function MergeTagMenu({
  textareaRef,
  value,
  onChange,
  disabled = false,
}: MergeTagMenuProps) {
  const insertTag = (tag: string) => {
    const field = textareaRef.current;
    const token = `{${tag}}`;

    if (!field) {
      onChange(`${value}${token}`);
      return;
    }

    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);

    // Refocus with the cursor placed after the inserted tag (design §3).
    requestAnimationFrame(() => {
      field.focus();
      const cursor = start + token.length;
      field.setSelectionRange(cursor, cursor);
    });
  };

  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button type="button" variant="outline" size="sm" disabled>
              <Braces aria-hidden="true" />
              Insert merge tag
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Click into a text field first</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Braces aria-hidden="true" />
          Insert merge tag
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72">
        {EMAIL_MERGE_TAG_DISPLAY.map((entry) => (
          <DropdownMenuItem
            key={entry.tag}
            onSelect={(event) => {
              event.preventDefault();
              insertTag(entry.tag);
            }}
            aria-label={`Insert ${entry.label} merge tag`}
          >
            <div className="flex min-w-0 flex-col">
              <span className="font-mono text-xs">{`{${entry.tag}}`}</span>
              <span className="text-xs text-muted-foreground">
                {entry.label} — {entry.hint}
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
