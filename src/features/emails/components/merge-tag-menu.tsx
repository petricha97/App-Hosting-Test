"use client";

import { Fragment, type RefObject } from "react";
import { Braces } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EmailComposerTokenSection } from "@/features/emails/types";
import { buildMergeTagTokenSection } from "@/features/emails/utils";

interface MergeTagMenuProps {
  textareaRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  tokenSections?: EmailComposerTokenSection[];
  buttonLabel?: string;
}

export function MergeTagMenu({
  textareaRef,
  value,
  onChange,
  disabled = false,
  tokenSections = [],
  buttonLabel = "Insert field",
}: MergeTagMenuProps) {
  const sections = [...tokenSections, buildMergeTagTokenSection()].filter(
    (section) => section.items.length > 0,
  );

  const insertToken = (token: string) => {
    const field = textareaRef.current;

    if (!field) {
      onChange(`${value}${token}`);
      return;
    }

    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);

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
              {buttonLabel}
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
          {buttonLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[30rem] w-[24rem] overflow-y-auto"
      >
        {sections.map((section, sectionIndex) => (
          <Fragment key={section.id}>
            {sectionIndex > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
              {section.label}
            </DropdownMenuLabel>
            {section.items.map((item) => (
              <DropdownMenuItem
                key={`${section.id}:${item.token}`}
                onSelect={(event) => {
                  event.preventDefault();
                  insertToken(item.token);
                }}
                aria-label={`Insert ${item.label}`}
              >
                <div className="flex min-w-0 flex-col gap-1 py-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.label}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {item.token}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {item.hint}
                  </span>
                  {item.previewValue?.trim() ? (
                    <span className="text-[11px] text-muted-foreground">
                      Preview: {item.previewValue}
                    </span>
                  ) : null}
                  {item.aliases?.length ? (
                    <span className="text-[11px] text-muted-foreground">
                      Also works: {item.aliases.join(", ")}
                    </span>
                  ) : null}
                </div>
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
