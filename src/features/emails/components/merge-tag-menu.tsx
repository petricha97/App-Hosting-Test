"use client";

// "Insert merge tag" dropdown (design §3) — lists all 14 T1 catalog tags
// with human labels + source hints; selecting inserts `{tag}` at the
// textarea's tracked cursor position and refocuses with the cursor placed
// after the inserted tag.
import type { RefObject } from "react";
import { Braces } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EMAIL_MERGE_TAG_DISPLAY } from "@/features/emails/utils";

interface MergeTagMenuProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
}

export function MergeTagMenu({
  textareaRef,
  value,
  onChange,
}: MergeTagMenuProps) {
  const insertTag = (tag: string) => {
    const textarea = textareaRef.current;
    const token = `{${tag}}`;

    if (!textarea) {
      onChange(`${value}${token}`);
      return;
    }

    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);

    // Refocus with the cursor placed after the inserted tag (design §3).
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + token.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

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
