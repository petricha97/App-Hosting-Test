// Route-level loading state for the Pricing screen: header + tabs strip +
// note banner + table-shaped card (design M2 §5). Tab switches after load are
// client-side over pre-fetched data — no per-switch skeleton.
import { Skeleton } from "@/components/ui/skeleton";

export default function EventPricingLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-24 rounded-md" />
        ))}
      </div>

      <Skeleton className="h-16 w-full rounded-2xl" />

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
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
