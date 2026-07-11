// Status pill for the merged attendee roster (M5-T2, design §1): dot + text
// — never color-only — with explicit dark-theme pairs kept >= 4.5:1. A
// dedicated component (not the FormDataStatus badge): the roster collapses
// new/pending/reviewed into one amber "Pending"; granular submission status
// lives on the Responses screen.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RosterRowStatus } from "@/features/attendees/roster";

const BADGE_CLASSES: Record<RosterRowStatus, string> = {
  accepted:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

const DOT_CLASSES: Record<RosterRowStatus, string> = {
  accepted: "bg-emerald-500",
  pending: "bg-amber-500",
};

const LABELS: Record<RosterRowStatus, string> = {
  accepted: "Accepted",
  pending: "Pending",
};

export function AttendeeStatusBadge({ status }: { status: RosterRowStatus }) {
  return (
    <Badge className={cn("rounded-full gap-1.5", BADGE_CLASSES[status])}>
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[status])}
      />
      {LABELS[status]}
    </Badge>
  );
}
