"use client";

// Shared loading / error / empty shells for the M1 registration screens.
// Loading is a table-shaped skeleton under the real page structure; error is
// an inline retryable panel in the table region (the shell stays interactive).
import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Full-screen skeleton used by the route-level loading.tsx files: header row,
// note banner, then a table shell with five placeholder rows.
export function EntityScreenSkeleton({
  withToolbar = false,
}: {
  withToolbar?: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>

      <Skeleton className="h-16 w-full rounded-2xl" />

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {withToolbar ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-9 w-48" />
            <span className="flex-1" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ) : null}
        <div className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4">
              <Skeleton className="h-5 w-1/3 min-w-32" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Inline retryable error panel rendered in the table region.
export function EntityTableError({
  entityLabel,
  onRetry,
}: {
  entityLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <AlertTriangle aria-hidden="true" className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          Couldn&apos;t load {entityLabel}
        </p>
        <p className="text-sm text-muted-foreground">
          Something went wrong on our side. Your data is safe.
        </p>
      </div>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

// True-empty state (no rows at all). The note banner renders above it, so
// this shell only carries the icon, copy, and the create CTA.
export function EntityEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      <Button onClick={onAction}>{actionLabel}</Button>
    </div>
  );
}
