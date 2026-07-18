import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceStatCardSkeleton } from "@/features/dashboard/components/workspace-stat-card";

function LowerCardHeaderSkeleton() {
  return (
    <CardHeader className="px-6 pt-6">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-6 w-64 max-w-full" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </CardHeader>
  );
}

export default function DashboardOverviewLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <WorkspaceStatCardSkeleton key={index} />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-2xl border-border bg-card py-0">
          <LowerCardHeaderSkeleton />
          <CardContent className="px-6 pb-6 pt-0">
            <div className="flex flex-wrap gap-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-36 rounded-md" />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border bg-card py-0">
          <LowerCardHeaderSkeleton />
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex items-start gap-3">
                <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                <div className="w-full space-y-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-2xl border-border bg-card py-0">
          <LowerCardHeaderSkeleton />
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-2xl" />
            ))}
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border bg-card py-0">
          <CardContent className="space-y-4 px-6 py-6">
            <Skeleton className="h-12 w-12 rounded-2xl" />
            <Skeleton className="h-6 w-56 max-w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-9 w-40 rounded-md" />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
