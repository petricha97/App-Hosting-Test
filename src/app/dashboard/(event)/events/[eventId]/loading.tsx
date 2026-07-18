import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EventOverviewStatCardSkeleton } from "@/features/event/overview";

export default function EventOverviewLoading() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <EventOverviewStatCardSkeleton key={index} />)}
      </div>
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card className="rounded-2xl py-0"><CardHeader className="px-5 pt-5"><Skeleton className="h-6 w-32" /></CardHeader><CardContent className="space-y-6 px-5 pb-5 pt-0"><div className="flex flex-wrap gap-3">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-11 w-36" />)}</div><Skeleton className="h-6 w-32" />{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex justify-between border-b py-3"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-32" /></div>)}</CardContent></Card>
        <Card className="rounded-2xl py-0"><CardHeader className="px-5 pt-5"><Skeleton className="h-6 w-36" /><Skeleton className="h-4 w-20" /></CardHeader><CardContent className="space-y-2 px-5 pb-5 pt-0">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</CardContent></Card>
      </div>
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
}
