import Link from "next/link";
import { CircleDashed, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getEventNavItem } from "@/features/event/event-nav";

interface ComingSoonProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Milestone tag, e.g. "M1". */
  milestone: string;
  eventId: string;
}

export function ComingSoon({
  icon: Icon,
  title,
  description,
  milestone,
  eventId,
}: ComingSoonProps) {
  return (
    <Card className="mx-auto mt-12 max-w-md space-y-3 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold">{title} is coming soon</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="flex justify-center">
        <Badge variant="outline" className="rounded-full">
          Coming in {milestone}
        </Badge>
      </div>
      <div className="pt-2">
        <Button asChild variant="outline" className="rounded-full">
          <Link href={`/dashboard/events/${encodeURIComponent(eventId)}`}>
            Back to overview
          </Link>
        </Button>
      </div>
    </Card>
  );
}

interface ComingSoonSectionProps {
  /** Nav segment under /dashboard/events/[eventId]/ — copy comes from event-nav. */
  segment: string;
  eventId: string;
}

export function ComingSoonSection({ segment, eventId }: ComingSoonSectionProps) {
  const item = getEventNavItem(segment);

  return (
    <ComingSoon
      icon={item?.icon ?? CircleDashed}
      title={item?.title ?? "This section"}
      description={
        item?.description ?? "This section is on the event workspace roadmap."
      }
      milestone={item?.milestone ?? "a later milestone"}
      eventId={eventId}
    />
  );
}
