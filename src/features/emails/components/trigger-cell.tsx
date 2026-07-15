"use client";

// Trigger column cell (design §1): the canonical display string. The
// "Automation arrives with M6-T3" info affordance (spec §1 AC-4, T2) is
// RETIRED here — M6-T3 (agents/docs/specs/m6-lifecycle-triggers.md) makes
// every non-manual trigger type fire for real (on-submit, on-accept,
// abandoned-24h, unpaid-offsets, scheduled), and `manual` never carried the
// tooltip to begin with (a real per-definition test-send has always existed
// for it). With all six trigger types now live, no row on this screen has
// anything left to caveat — the label alone is the honest, current state.
import type { SerializedEmailDefinitionTrigger } from "@/features/emails/types";
import { triggerDisplayLabel } from "@/features/emails/utils";

interface TriggerCellProps {
  trigger: SerializedEmailDefinitionTrigger;
  timeZone: string;
}

export function TriggerCell({ trigger, timeZone }: TriggerCellProps) {
  const label = triggerDisplayLabel(trigger, timeZone);
  const isNotScheduled = trigger.type === "scheduled" && trigger.atMs === null;

  return (
    <span className={isNotScheduled ? "text-muted-foreground" : undefined}>
      {label}
    </span>
  );
}
