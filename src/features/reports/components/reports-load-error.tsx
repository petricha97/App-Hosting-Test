"use client";

// Page-level (whole-page fetch failure) retry panel for the reports screen
// (design §0) — distinct from the per-card independent error state below,
// which is the expected/primary error path (spec §5).

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function ReportsLoadError() {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Registration and finance snapshots for this event.
        </p>
      </div>
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-12 text-center">
        <p className="text-sm font-semibold text-foreground">
          Couldn&apos;t load report data
        </p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          Something went wrong on our side. Try again in a moment.
        </p>
        <Button variant="outline" onClick={() => router.refresh()}>
          Retry
        </Button>
      </div>
    </div>
  );
}
