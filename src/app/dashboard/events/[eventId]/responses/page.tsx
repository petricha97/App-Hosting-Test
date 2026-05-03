import { Inbox, ListFilter, PanelRight } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import { placeholderResponses } from "@/features/dashboard/mock-data";

interface EventResponsesPageProps {
  params: Promise<{ eventId: string }>;
}

export default async function DashboardEventResponsesPage({
  params,
}: EventResponsesPageProps) {
  const { eventId } = await params;
  const eventLabel = decodeURIComponent(eventId);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Event responses"
        title={`Response workspace for ${eventLabel}`}
        description="This page is structured for a list-and-detail review experience. It stays stacked on smaller screens and opens up into a dual-panel workflow on larger displays."
      />

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.75fr)]">
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                <Inbox className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-2xl text-slate-950">
                  Submission list
                </CardTitle>
                <CardDescription>
                  Filters and attendee submissions will appear here.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                readOnly
                value=""
                placeholder="Search attendee names or answers"
                className="h-11 rounded-full border-slate-200 bg-slate-50"
              />
              <Button variant="outline" className="h-11 rounded-full">
                <ListFilter className="mr-2 h-4 w-4" />
                Filter
              </Button>
            </div>

            {placeholderResponses.map((response) => (
              <div
                key={response.id}
                className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950">
                      {response.attendeeName}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {response.submittedLabel}
                    </p>
                  </div>
                  <span className="rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-semibold text-orange-900">
                    {response.status}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-7 text-slate-600">
                  Event context: {response.eventName}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                <PanelRight className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-2xl text-slate-950">
                  Response detail
                </CardTitle>
                <CardDescription>
                  Selecting a submission will open the attendee detail view here.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-6 pb-6 pt-0 text-sm leading-7 text-slate-600">
            <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-5">
              Registration answers and answer groups.
            </div>
            <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-5">
              Status changes, notes, and reviewer actions.
            </div>
            <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-5">
              Future export, invoice, and promotion hooks.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
