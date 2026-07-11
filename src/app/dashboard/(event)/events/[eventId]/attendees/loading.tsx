// Route-level loading state for the Attendees screen (M5-T2, design §1):
// header + tabs strip + toolbar row + 6 skeleton rows under the table card
// (name column wider). Tab switches after load are client-side over
// pre-fetched data — no per-switch skeleton.
import { Skeleton } from "@/components/ui/skeleton";

export default function EventAttendeesLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="flex gap-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-28 rounded-md" />
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-9 w-36" />
          <span className="flex-1" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4">
              <Skeleton className="h-4 w-1/4 min-w-32" />
              <Skeleton className="h-4 w-1/5" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
