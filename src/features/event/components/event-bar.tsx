"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, getInitials } from "@/lib/utils";

export interface EventBarEvent {
  id: string;
  name: string;
  status: "Draft" | "Published";
  /** Pre-formatted "date, time range · timezone" label; null when unscheduled. */
  dateLabel: string | null;
  /** Venue/location label; the current Event model has none, so usually null. */
  venue: string | null;
}

interface EventBarProps {
  /** undefined → loading skeleton; the shell renders EventNotFound before null. */
  event: EventBarEvent | undefined;
  /** Slot rendered before the logo tile (mobile menu trigger). */
  leading?: React.ReactNode;
  /** Extra breadcrumb segment after the event name (e.g. "Edit"). */
  trailingCrumb?: string | null;
}

function StatusBadge({ status }: { status: EventBarEvent["status"] }) {
  const isPublished = status === "Published";

  return (
    <Badge
      variant={isPublished ? "default" : "secondary"}
      className={cn(
        "shrink-0 gap-1.5 rounded-full px-3 py-1",
        isPublished &&
          "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </Badge>
  );
}

export function EventBar({ event, leading, trailingCrumb }: EventBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-6 lg:px-8">
        {leading}

        {event === undefined ? (
          <>
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-80 max-w-full" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </>
        ) : (
          <>
            <Avatar className="h-11 w-11 rounded-xl">
              <AvatarFallback className="rounded-xl bg-[linear-gradient(135deg,#ffb082,#ff7a59)] text-sm font-semibold text-white">
                {getInitials(event.name) || "EV"}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <Link
                  href="/dashboard/events"
                  className="rounded transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Events
                </Link>
                <span aria-hidden>/</span>
                <span className="truncate normal-case tracking-normal">
                  {event.name}
                </span>
                {trailingCrumb ? (
                  <>
                    <span aria-hidden>/</span>
                    <span className="shrink-0 normal-case tracking-normal">
                      {trailingCrumb}
                    </span>
                  </>
                ) : null}
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-3">
                <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                  {event.name}
                </h1>
                <StatusBadge status={event.status} />
              </div>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {event.dateLabel ? <span>{event.dateLabel}</span> : null}
                {event.dateLabel && event.venue ? (
                  <span aria-hidden> · </span>
                ) : null}
                {event.venue ? <span>{event.venue}</span> : null}
                {event.dateLabel || event.venue ? (
                  <span aria-hidden> · </span>
                ) : null}
                <span
                  className="font-mono text-xs"
                  aria-label={`Event code ${event.id}`}
                >
                  {event.id}
                </span>
              </p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button asChild variant="outline" className="rounded-full">
                <Link
                  href={`/events/${encodeURIComponent(event.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Preview
                </Link>
              </Button>
              {/* Reserved slot: "Publish changes" primary action lands in M8-T3. */}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
