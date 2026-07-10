import { Skeleton } from "@/components/ui/skeleton";
import { EntityScreenSkeleton } from "@/features/registration/components/entity-table-states";

export default function EventRegistrationPathsLoading() {
  return (
    <div className="space-y-6">
      {/* Flow-diagram card placeholder (design §1). */}
      <Skeleton className="h-28 w-full rounded-2xl" />
      <EntityScreenSkeleton />
    </div>
  );
}
