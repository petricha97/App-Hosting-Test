// Status pill for the responses tables (M3-T4, design §4): leading dot +
// text — never color-only — with explicit dark-theme pairs kept >= 4.5:1.
import { Badge } from "@/components/ui/badge";
import { FORM_DATA_STATUS_LABELS } from "@/features/responses/status-utils";
import { cn } from "@/lib/utils";
import type { FormDataStatus } from "@/types/collection";

const BADGE_CLASSES: Record<FormDataStatus, string> = {
  accepted:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  new: "bg-secondary text-secondary-foreground",
  reviewed: "border-border bg-transparent text-foreground",
};

const DOT_CLASSES: Record<FormDataStatus, string> = {
  accepted: "bg-emerald-500",
  pending: "bg-amber-500",
  new: "bg-slate-400",
  reviewed: "bg-sky-500",
};

export function StatusBadge({ status }: { status: FormDataStatus }) {
  return (
    <Badge className={cn("rounded-full gap-1.5", BADGE_CLASSES[status])}>
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[status])}
      />
      {FORM_DATA_STATUS_LABELS[status]}
    </Badge>
  );
}
