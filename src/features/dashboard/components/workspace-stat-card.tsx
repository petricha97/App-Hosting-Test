"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatMoney } from "@/features/pricing/utils";
import type {
  WorkspaceRegistrationsSummary,
  WorkspaceRevenueSummary,
} from "@/features/dashboard/server/load-workspace-summary";

interface WorkspaceStatCardProps {
  title: string;
  value: string;
  hint: string;
  errored?: boolean;
  onRetry?: () => void;
  secondary?: ReactNode;
  tooltip?: ReactNode;
}

export function WorkspaceStatCard({
  title,
  value,
  hint,
  errored = false,
  onRetry,
  secondary,
  tooltip,
}: WorkspaceStatCardProps) {
  return (
    <Card className="rounded-2xl border-border bg-card py-0">
      <CardHeader className="px-5 pt-5">
        <CardDescription className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </CardDescription>
        <div className="flex min-w-0 items-start gap-2">
          <CardTitle
            className={
              errored
                ? "break-words text-3xl font-semibold tracking-tight text-muted-foreground tabular-nums"
                : "break-words text-3xl font-semibold tracking-tight text-foreground tabular-nums"
            }
          >
            {value}
          </CardTitle>
          {tooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  aria-label="Revenue by currency"
                >
                  <Info className="h-3 w-3" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {secondary ? (
          <div className="text-xs text-muted-foreground">{secondary}</div>
        ) : null}
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-0">
        {errored ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
            <span>Couldn&apos;t load</span>
            {onRetry ? (
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto px-0 text-xs text-destructive"
                onClick={onRetry}
              >
                Retry
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function WorkspaceStatCardSkeleton() {
  return (
    <Card className="rounded-2xl border-border bg-card py-0">
      <CardHeader className="px-5 pt-5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-24" />
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-0">
        <Skeleton className="h-4 w-full" />
      </CardContent>
    </Card>
  );
}

export function registrationStatValue(
  registrations: WorkspaceRegistrationsSummary,
) {
  return "loadError" in registrations ? "—" : String(registrations.value);
}

export function revenueStatPresentation(revenue: WorkspaceRevenueSummary) {
  if ("loadError" in revenue) {
    return {
      value: "—",
      hint: "Paid orders across every event in this workspace.",
    };
  }

  if (revenue.kind === "zero-currency") {
    return {
      value: "$0",
      hint: "Paid orders across every event in this workspace.",
    };
  }

  if (revenue.kind === "single") {
    return {
      value: formatMoney(revenue.paidMinor, revenue.currency),
      hint: "Paid orders across every event in this workspace.",
    };
  }

  const otherCurrencies = [...revenue.otherCurrencies].sort((left, right) =>
    left.currency.localeCompare(right.currency),
  );

  return {
    value: formatMoney(revenue.primaryPaidMinor, revenue.primaryCurrency),
    secondary:
      otherCurrencies.length === 1
        ? `+ ${otherCurrencies[0].currency} ${new Intl.NumberFormat("en-US").format(otherCurrencies[0].paidMinor / 100)} paid in other currencies`
        : `+ ${otherCurrencies.length} other currencies`,
    tooltip: (
      <div className="space-y-1">
        {otherCurrencies.map((entry) => (
          <div key={entry.currency} className="flex justify-between gap-4">
            <span>{entry.currency}</span>
            <span>{formatMoney(entry.paidMinor, entry.currency)}</span>
          </div>
        ))}
      </div>
    ),
    hint: "Paid order totals are not converted or blended across currencies.",
  };
}
