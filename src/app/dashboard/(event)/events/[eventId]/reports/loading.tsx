// Route-level loading state for the Reports screen (design §0): header
// skeleton + the two cards' own skeleton exports, same grid gap-6
// lg:grid-cols-2 as the real content.
import { Skeleton } from "@/components/ui/skeleton";
import { FinanceSummaryCardSkeleton } from "@/features/reports/components/finance-summary-card";
import { TicketTypeBarChartCardSkeleton } from "@/features/reports/components/ticket-type-bar-chart-card";

export default function EventReportsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TicketTypeBarChartCardSkeleton />
        <FinanceSummaryCardSkeleton />
      </div>
    </div>
  );
}
