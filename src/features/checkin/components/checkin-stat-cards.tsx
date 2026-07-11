// Check-in stat row (M5-T4 AC-1, design §3): three cards fed by aggregate
// count queries — Checked in (with the "event not started" sub-caption only
// when 0 and the event start is in the future), Expected (= accepted
// Attendee count) and Badges ready (= accepted count in M5: every badge is
// generatable on demand since the QR is deterministic; true print tracking
// is an M7 report).

import { CheckCircle2, Printer, Ticket } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

interface CheckinStatCardsProps {
  checkedInCount: number;
  expectedCount: number;
  eventStartInFuture: boolean;
}

function StatCard({
  icon: Icon,
  caption,
  value,
  subCaption,
}: {
  icon: LucideIcon;
  caption: string;
  value: number;
  subCaption?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 px-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon aria-hidden="true" className="h-4 w-4" />
          {caption}
        </div>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        {subCaption ? (
          <p className="text-xs text-muted-foreground">{subCaption}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CheckinStatCards({
  checkedInCount,
  expectedCount,
  eventStartInFuture,
}: CheckinStatCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <StatCard
        icon={CheckCircle2}
        caption="Checked in"
        value={checkedInCount}
        subCaption={
          checkedInCount === 0 && eventStartInFuture
            ? "event not started"
            : undefined
        }
      />
      <StatCard icon={Ticket} caption="Expected" value={expectedCount} />
      <StatCard icon={Printer} caption="Badges ready" value={expectedCount} />
    </div>
  );
}
