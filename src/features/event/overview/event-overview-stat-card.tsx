import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EventOverviewRetry } from "./event-overview-retry";

export function EventOverviewStatCard({
  title,
  value,
  hint,
  error = false,
}: {
  title: string;
  value: ReactNode;
  hint: ReactNode;
  error?: boolean;
}) {
  return (
    <Card className="min-w-0 rounded-2xl border-border bg-card py-0">
      <CardHeader className="px-5 pt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <CardTitle className={`min-h-10 break-words text-3xl font-semibold tracking-tight tabular-nums ${error ? "text-muted-foreground" : "text-foreground"}`}>
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-0">
        {error ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
            <span>Couldn&apos;t load</span>
            <EventOverviewRetry className="h-auto px-0 text-xs text-destructive" />
          </div>
        ) : (
          <div className="text-sm leading-6 text-muted-foreground">{hint}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function EventOverviewStatCardSkeleton() {
  return (
    <Card className="rounded-2xl border-border bg-card py-0">
      <CardHeader className="px-5 pt-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-28" />
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-0">
        <Skeleton className="h-4 w-full" />
      </CardContent>
    </Card>
  );
}
