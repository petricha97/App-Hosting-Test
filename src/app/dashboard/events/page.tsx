import Link from "next/link";
import { CalendarRange, Filter, Search, TicketPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DashboardEmptyState } from "@/features/dashboard/components/empty-state";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import { placeholderEvents } from "@/features/dashboard/mock-data";

export default function DashboardEventsPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Events"
        title="Design the event management surface before real data flows in."
        description="This page is the home for browsing, filtering, creating, and opening events. The structure is ready even while schema details and collection shape continue to evolve."
        actions={
          <Button asChild>
            <Link href="/dashboard/events/new">Create Event</Link>
          </Button>
        }
      />

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-xl text-slate-950">
            Event index controls
          </CardTitle>
          <CardDescription>
            Filters, search, and status views will live here once events are wired in.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 px-6 pb-6 pt-0 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              readOnly
              value=""
              placeholder="Search event names, statuses, or owners"
              className="h-11 rounded-full border-slate-200 bg-slate-50 pl-10"
            />
          </div>
          <Button variant="outline" className="h-11 rounded-full">
            <Filter className="mr-2 h-4 w-4" />
            Status
          </Button>
          <Button variant="outline" className="h-11 rounded-full">
            <CalendarRange className="mr-2 h-4 w-4" />
            Date range
          </Button>
        </CardContent>
      </Card>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <DashboardEmptyState
          icon={TicketPlus}
          title="Your event index is ready for the first real item"
          description="As events are created, this page will support cards or table views, filters, publish states, and links into each event workspace."
          primaryAction={{
            label: "Create Event",
            href: "/dashboard/events/new",
          }}
          secondaryAction={{
            label: "Open forms",
            href: "/dashboard/forms",
            variant: "outline",
          }}
          className="bg-white/92"
        />

        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
              Event card preview
            </CardDescription>
            <CardTitle className="text-2xl text-slate-950">
              Example of the event management UI
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {placeholderEvents.map((event) => (
              <div
                key={event.id}
                className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-950">
                        {event.name}
                      </h3>
                      <Badge
                        variant="outline"
                        className="rounded-full border-orange-200 bg-white text-orange-900"
                      >
                        {event.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {event.dateLabel}
                    </p>
                  </div>
                  <Button asChild variant="outline" className="rounded-full">
                    <Link href={`/dashboard/events/${event.id}`}>Open</Link>
                  </Button>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                    {event.responseLabel}
                  </div>
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                    {event.formStatus}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
