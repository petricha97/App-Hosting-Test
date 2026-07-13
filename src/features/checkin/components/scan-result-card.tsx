"use client";

// Scan result takeover (M5-T5, design §4): full-screen overlay wrapped in
// role="status" aria-live="polite" so every result is announced. Variants:
//   resolved      — attendee card + h-14 "Check in" (resolve ≠ confirm);
//   checked-in    — emerald success after the confirm;
//   already       — amber, ORIGINAL "at 09:42 by Maria" record;
//   invalid/cancelled — red; wrong-event — slate (zero data);
//   not-accepted  — blue "direct to the help desk"; error — generic retry.
// Touch targets: confirm h-14, "Scan next" h-12 (gloved thumbs). Pills carry
// text, never color alone; the -900/-200 dark pairs keep 4.5:1 contrast.

import {
  CheckCircle2,
  CircleSlash,
  Clock,
  Info,
  Loader2,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatCheckedInTime,
  type ScanAttendeeCard,
  type ScanOutcome,
} from "@/features/checkin/scan-types";
import { cn } from "@/lib/utils";

interface ScanResultCardProps {
  outcome: ScanOutcome;
  confirming?: boolean;
  onConfirm?: () => void;
  onScanNext: () => void;
}

interface VariantChrome {
  wash: string;
  iconWrap: string;
  icon: LucideIcon;
  headline: string;
  detail?: string;
}

function attendeeDetails(attendee: ScanAttendeeCard) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-lg font-semibold text-foreground">{attendee.name}</p>
      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-900 dark:bg-violet-950 dark:text-violet-200">
          {attendee.registrationTypeLabel}
        </span>
        <span className="text-muted-foreground">{attendee.ticketLabel}</span>
      </div>
    </div>
  );
}

function chromeFor(outcome: ScanOutcome): VariantChrome {
  switch (outcome.kind) {
    case "resolved":
      return {
        wash: "bg-emerald-50 dark:bg-emerald-950/40",
        iconWrap:
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
        icon: CheckCircle2,
        headline: "Pass valid",
        detail: "Not checked in yet",
      };
    case "checked-in": {
      const time = formatCheckedInTime(outcome.checkedInAtIso);
      return {
        wash: "bg-emerald-50 dark:bg-emerald-950/40",
        iconWrap:
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
        icon: CheckCircle2,
        headline: "Checked in",
        detail: time ? `at ${time}` : undefined,
      };
    }
    case "already": {
      const time = formatCheckedInTime(outcome.checkedInAtIso);
      const by = outcome.checkedInByName;
      const detail =
        time && by
          ? `at ${time} by ${by}`
          : time
            ? `at ${time}`
            : by
              ? `by ${by}`
              : undefined;
      return {
        wash: "bg-amber-50 dark:bg-amber-950/40",
        iconWrap:
          "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
        icon: Clock,
        headline: "Already checked in",
        detail,
      };
    }
    case "cancelled":
      return {
        wash: "bg-red-50 dark:bg-red-950/40",
        iconWrap: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
        icon: XCircle,
        headline: "Registration cancelled",
      };
    case "wrong-event":
      return {
        wash: "bg-slate-50 dark:bg-slate-900/60",
        iconWrap:
          "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
        icon: CircleSlash,
        headline: "This pass belongs to a different event.",
      };
    case "not-accepted":
      return {
        wash: "bg-sky-50 dark:bg-sky-950/40",
        iconWrap: "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300",
        icon: Info,
        headline: "Registration not yet accepted",
        detail: "Direct to the help desk.",
      };
    case "error":
      return {
        wash: "bg-muted",
        iconWrap: "bg-background text-muted-foreground",
        icon: TriangleAlert,
        headline: "Something went wrong",
        detail: "Check your connection and scan again.",
      };
    default:
      return {
        wash: "bg-red-50 dark:bg-red-950/40",
        iconWrap: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
        icon: XCircle,
        headline: "Invalid pass",
      };
  }
}

export function ScanResultCard({
  outcome,
  confirming = false,
  onConfirm,
  onScanNext,
}: ScanResultCardProps) {
  const chrome = chromeFor(outcome);
  const Icon = chrome.icon;
  const attendee =
    outcome.kind === "resolved" ||
    outcome.kind === "checked-in" ||
    outcome.kind === "already"
      ? outcome.attendee
      : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-10",
        chrome.wash,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex h-16 w-16 items-center justify-center rounded-full",
          chrome.iconWrap,
        )}
      >
        <Icon className="h-8 w-8" />
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          {chrome.headline}
        </h2>
        {chrome.detail ? (
          <p className="text-sm text-muted-foreground">{chrome.detail}</p>
        ) : null}
      </div>

      {attendee ? attendeeDetails(attendee) : null}

      <div className="flex w-full max-w-sm flex-col gap-3">
        {outcome.kind === "resolved" && onConfirm ? (
          <Button
            className="h-14 w-full text-base"
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            Check in
          </Button>
        ) : null}
        <Button
          variant="outline"
          className="h-12 w-full bg-background"
          onClick={onScanNext}
          disabled={confirming}
        >
          Scan next
        </Button>
      </div>
    </div>
  );
}
