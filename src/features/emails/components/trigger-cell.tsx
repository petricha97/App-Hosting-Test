"use client";

// Trigger column cell (design §1): the canonical display string + the
// M6-T3-not-built info affordance on every non-manual row (spec §1 AC-4).
import { Info } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SerializedEmailDefinitionTrigger } from "@/features/emails/types";
import {
  isAutomatedTrigger,
  triggerDisplayLabel,
} from "@/features/emails/utils";

interface TriggerCellProps {
  trigger: SerializedEmailDefinitionTrigger;
  timeZone: string;
}

export function TriggerCell({ trigger, timeZone }: TriggerCellProps) {
  const label = triggerDisplayLabel(trigger, timeZone);
  const isNotScheduled = trigger.type === "scheduled" && trigger.atMs === null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={isNotScheduled ? "text-muted-foreground" : undefined}>
        {label}
      </span>
      {isAutomatedTrigger(trigger) ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="text-muted-foreground">
              <Info aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="sr-only">Automation not yet built</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Automation arrives with M6-T3; this email will not send
            automatically yet.
          </TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  );
}
