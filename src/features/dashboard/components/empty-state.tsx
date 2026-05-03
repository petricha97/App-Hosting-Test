import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DashboardActionLink {
  label: string;
  href: string;
  variant?: "default" | "outline";
}

interface DashboardEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  primaryAction?: DashboardActionLink;
  secondaryAction?: DashboardActionLink;
  className?: string;
}

export function DashboardEmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
}: DashboardEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-5 rounded-[1.75rem] border border-dashed border-slate-200 bg-slate-50/80 p-6 text-left",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm">
        <Icon className="h-5 w-5" />
      </div>

      <div className="space-y-2">
        <h3 className="text-xl font-semibold text-slate-950">{title}</h3>
        <p className="max-w-2xl text-sm leading-7 text-slate-600">
          {description}
        </p>
      </div>

      {(primaryAction || secondaryAction) ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          {primaryAction ? (
            <Button asChild>
              <Link href={primaryAction.href}>{primaryAction.label}</Link>
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button asChild variant={secondaryAction.variant ?? "outline"}>
              <Link href={secondaryAction.href}>{secondaryAction.label}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
