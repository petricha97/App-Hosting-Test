"use client";

// Row action menu for the responses tables (M3-T4, design §4): offers ONLY
// the legal forward transitions from the row's current status, so the menu
// can never request a move the server would 409. Accepted rows render no
// menu at all (terminal in M3) — the parent shows an em-dash instead.
import { Check, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  STATUS_ACTION_LABELS,
  forwardFormDataStatuses,
} from "@/features/responses/status-utils";
import type { FormDataStatus } from "@/types/collection";

interface ResponseActionsMenuProps {
  attendeeName: string;
  status: FormDataStatus;
  disabled?: boolean;
  onTransition: (to: FormDataStatus) => void;
}

export function ResponseActionsMenu({
  attendeeName,
  status,
  disabled = false,
  onTransition,
}: ResponseActionsMenuProps) {
  const targets = forwardFormDataStatuses(status);

  if (targets.length === 0) {
    // Terminal (accepted) — no actions exist in M3.
    return (
      <span aria-hidden="true" className="text-muted-foreground">
        —
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Actions for ${attendeeName}`}
          disabled={disabled}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {targets.map((to) =>
          to === "new" ? null : (
            <DropdownMenuItem
              key={to}
              className={
                to === "accepted"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : undefined
              }
              onSelect={() => onTransition(to)}
            >
              {to === "accepted" ? <Check aria-hidden="true" /> : null}
              {STATUS_ACTION_LABELS[to]}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
