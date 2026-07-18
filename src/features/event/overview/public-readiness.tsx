import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleHelp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EventOverviewData } from "./event-overview-types";
import { EventOverviewRetry } from "./event-overview-retry";

export function PublicReadiness({ readiness }: { readiness: EventOverviewData["readiness"] }) {
  const ready = readiness.filter((item) => item.state === "done").length;
  const hasUnknown = readiness.some((item) => item.state === "unknown");
  return (
    <section aria-labelledby="public-readiness-heading">
      <Card className="min-w-0 rounded-2xl border-border bg-card py-0">
        <CardHeader className="flex-row items-start justify-between gap-3 px-5 pt-5">
          <div><CardTitle id="public-readiness-heading" className="text-xl">Public readiness</CardTitle><p className="mt-1 text-sm text-muted-foreground">{ready} / 6 ready</p></div>
          {hasUnknown ? <EventOverviewRetry /> : null}
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-0">
          <ul className="space-y-2">
            {readiness.map((item) => {
              const Icon = item.state === "done" ? CheckCircle2 : item.state === "pending" ? CircleAlert : CircleHelp;
              const content = <><Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${item.state === "done" ? "text-emerald-600 dark:text-emerald-400" : item.state === "pending" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} /><span className="min-w-0"><span className="block break-words text-sm font-medium">{item.label}</span><span className="mt-0.5 block break-words text-xs leading-5 text-muted-foreground">{item.detail}</span></span></>;
              return <li key={item.id}>{item.state === "done" || !item.href ? <div className="flex min-h-11 gap-3 rounded-lg p-2">{content}</div> : <Link href={item.href} aria-label={`Fix ${item.label}: open settings`} className="flex min-h-11 gap-3 rounded-lg p-2 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</Link>}</li>;
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
