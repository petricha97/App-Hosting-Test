// Example flow-diagram card for the Registration Paths screen (M3-T1 AC-3):
// shows the first ACTIVE path's step chips — 5 for card/invoice, 4 for
// comp/none (Payment omitted entirely, renumbered) plus a "Payment skipped"
// badge. Chips are static (not buttons); page-builder links land in M4-T2.
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { SerializedRegistrationPath } from "@/features/registration-paths/types";
import {
  buildFlowSteps,
  paymentSkippedLabel,
} from "@/features/registration-paths/utils";

interface FlowDiagramCardProps {
  path: SerializedRegistrationPath;
}

export function FlowDiagramCard({ path }: FlowDiagramCardProps) {
  const steps = buildFlowSteps(path.paymentMethod);
  const skippedLabel = paymentSkippedLabel(path.paymentMethod);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-sm font-semibold text-foreground">
        Path: {path.name}
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Each page is customizable in the Page Builder.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {steps.map((step, index) => (
          <div key={step.title} className="flex items-center gap-2">
            {index > 0 ? (
              <ChevronRight
                aria-hidden="true"
                className="h-3.5 w-3.5 text-muted-foreground"
              />
            ) : null}
            <span className="rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground">
              {step.number} · {step.title}
            </span>
          </div>
        ))}
        {skippedLabel ? (
          <Badge variant="secondary" className="rounded-full">
            {skippedLabel}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
