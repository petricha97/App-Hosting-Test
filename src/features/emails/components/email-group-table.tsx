"use client";

// Shared grouped table (design §1) — 4-column (Email | Trigger | Audience |
// Active) for Pre-event / Post-registration, 3-column (Email | Trigger |
// Active, no Audience) for Debt chase. System rows render no actions cell
// (no delete affordance); custom rows get a ghost Trash2 icon.
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmailActiveSwitch } from "@/features/emails/components/email-active-switch";
import { TriggerCell } from "@/features/emails/components/trigger-cell";
import type { SerializedEmailDefinition } from "@/features/emails/types";
import { EMAIL_AUDIENCE_LABELS } from "@/features/emails/utils";

interface EmailGroupTableProps {
  ariaLabel: string;
  columns: "4col" | "3col";
  definitions: SerializedEmailDefinition[];
  timeZone: string;
  activeOverrides: Record<string, boolean>;
  togglingKind: string | null;
  onToggle: (definition: SerializedEmailDefinition) => void;
  onOpenEditor: (kind: string) => void;
  onDeleteCustom: (definition: SerializedEmailDefinition) => void;
}

export function EmailGroupTable({
  ariaLabel,
  columns,
  definitions,
  timeZone,
  activeOverrides,
  togglingKind,
  onToggle,
  onOpenEditor,
  onDeleteCustom,
}: EmailGroupTableProps) {
  const is4col = columns === "4col";

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <Table
          aria-label={ariaLabel}
          className={is4col ? "min-w-[48rem]" : "min-w-[40rem]"}
        >
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-48">Email</TableHead>
              <TableHead>Trigger</TableHead>
              {is4col ? <TableHead>Audience</TableHead> : null}
              <TableHead>Active</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {definitions.map((definition) => {
              const checked =
                activeOverrides[definition.kind] ?? definition.enabled;
              return (
                <TableRow key={definition.kind}>
                  <TableCell>
                    <button
                      type="button"
                      className="text-left font-medium text-foreground hover:underline focus-visible:underline"
                      onClick={() => onOpenEditor(definition.kind)}
                    >
                      {definition.name}
                    </button>
                  </TableCell>
                  <TableCell>
                    <TriggerCell
                      trigger={definition.trigger}
                      timeZone={timeZone}
                    />
                  </TableCell>
                  {is4col ? (
                    <TableCell>
                      {EMAIL_AUDIENCE_LABELS[definition.audience]}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <EmailActiveSwitch
                      name={definition.name}
                      checked={checked}
                      disabled={togglingKind === definition.kind}
                      onCheckedChange={() => onToggle(definition)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    {definition.isSystem ? null : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${definition.name}`}
                        onClick={() => onDeleteCustom(definition)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
