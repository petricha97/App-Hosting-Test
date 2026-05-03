import Link from "next/link";
import { Inbox, ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardEmptyState } from "@/features/dashboard/components/empty-state";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import { placeholderResponses } from "@/features/dashboard/mock-data";

export default function DashboardResponsesPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Responses"
        title="Track submissions across all events from one place."
        description="This page is the aggregate response inbox for the active workspace. It complements event-specific response routes without replacing them."
      />

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
              Submission inbox preview
            </CardDescription>
            <CardTitle className="text-2xl text-slate-950">
              A workspace-wide view of responses
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {placeholderResponses.map((response) => (
              <div
                key={response.id}
                className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950">
                      {response.attendeeName}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {response.eventName}
                    </p>
                  </div>
                  <span className="rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-semibold text-orange-900">
                    {response.status}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-7 text-slate-600">
                  {response.submittedLabel}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <DashboardEmptyState
          icon={Inbox}
          title="Responses will become one review workflow"
          description="Once registrations open, this page should help the team scan new submissions quickly and jump into event-specific detail views."
          primaryAction={{
            label: "Open Event Responses",
            href: "/dashboard/events/design-breakfast/responses",
          }}
          secondaryAction={{
            label: "Create Event",
            href: "/dashboard/events/new",
            variant: "outline",
          }}
          className="bg-white/92"
        />
      </section>

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
              <ListChecks className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-2xl text-slate-950">
                Future response layers
              </CardTitle>
              <CardDescription>
                Notes, review states, exports, and invoice hooks can all grow
                here without changing the dashboard navigation model.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-0">
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/dashboard/settings">Open workspace settings</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
