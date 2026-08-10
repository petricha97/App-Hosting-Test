"use client";

// "Design existing email" definition-picker menu (design §1) — replaces the
// disabled button in emails-workspace.tsx. Grouped by the SAME 3 groups the
// lifecycle table already renders (EMAIL_GROUP_LABELS), reusing
// `definitionsByKind`'s already-loaded data — no new fetch (spec §4 "no new
// API route"). Selecting an item opens EmailEditorDialog for that kind with
// `forceInitialMode="blocks"` — the ONLY entry point that forces the mode
// toggle; ordinary row-click editing elsewhere keeps defaulting to whatever
// bodyMode is currently persisted (design §1).
import { Blocks } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SerializedEmailDefinition } from "@/features/emails/types";
import {
  EMAIL_GROUP_LABELS,
  EMAIL_GROUP_OPTIONS,
  triggerDisplayLabel,
} from "@/features/emails/utils";

interface EmailDefinitionPickerMenuProps {
  definitions: SerializedEmailDefinition[];
  timeZone: string;
  onSelect: (kind: string) => void;
}

export function EmailDefinitionPickerMenu({
  definitions,
  timeZone,
  onSelect,
}: EmailDefinitionPickerMenuProps) {
  const definitionsByGroup = (group: SerializedEmailDefinition["group"]) =>
    definitions.filter((definition) => definition.group === group);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Blocks aria-hidden="true" />
          Design existing email
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {EMAIL_GROUP_OPTIONS.map((group, groupIndex) => {
          const groupDefinitions = definitionsByGroup(group);
          if (groupDefinitions.length === 0) return null;

          return (
            <div key={group}>
              {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                {EMAIL_GROUP_LABELS[group]}
              </DropdownMenuLabel>
              {groupDefinitions.map((definition) => {
                const triggerLabel = triggerDisplayLabel(
                  definition.trigger,
                  timeZone,
                );
                const isDesigned = definition.bodyMode === "blocks";

                return (
                  <DropdownMenuItem
                    key={definition.kind}
                    onSelect={() => onSelect(definition.kind)}
                    aria-label={`Open ${definition.name} (${triggerLabel}) in the block designer`}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">
                          {definition.name}
                        </span>
                        {isDesigned ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Designed
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {triggerLabel}
                      </span>
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
