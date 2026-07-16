// Presentational "Registrations by ticket type" bar list (spec §6, design
// §1). Accepts the plain { label, count }[] shape — no chart-library-specific
// data leaks in (spec §6 AC-2). Rows arrive pre-sorted from the server
// loader; this component only renders + computes bar widths.
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { TicketTypeRegistrationRow } from "@/features/reports/types";

export interface TicketTypeBarChartProps {
  rows: TicketTypeRegistrationRow[];
}

export function TicketTypeBarChart({ rows }: TicketTypeBarChartProps) {
  // The `1` floor prevents divide-by-zero on the all-zero-registrations case
  // (spec §1: "all-zero event ... renders every bar at empty width").
  const max = Math.max(1, ...rows.map((row) => row.count));

  return (
    <div className="space-y-4">
      {rows.map((row, index) => {
        // Math.max(4, ...) is the "visually non-trivial minimum" (design §1):
        // a non-zero count never collapses to a hairline next to a 100% bar.
        const pct =
          row.count === 0
            ? 0
            : Math.max(4, Math.round((row.count / max) * 100));

        return (
          // Index appended: ticket-type names aren't guaranteed unique in
          // the data model (only `code` is), so label alone isn't a safe key.
          <div key={`${row.label}-${index}`} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-foreground" title={row.label}>
                {row.label}
              </span>
              <span
                className={cn(
                  "shrink-0 font-semibold tabular-nums",
                  row.count === 0
                    ? "text-muted-foreground font-normal"
                    : "text-foreground",
                )}
              >
                {row.count}
              </span>
            </div>
            <Progress
              value={pct}
              aria-label={`${row.label}: ${row.count} ${
                row.count === 1 ? "registration" : "registrations"
              }`}
              className="h-2"
            />
          </div>
        );
      })}
    </div>
  );
}
