import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  FileStack,
  FolderOpen,
  Inbox,
  Sparkles,
  WandSparkles,
} from "lucide-react";

import type { SerializedEvent } from "@/features/event/utils";
import { DashboardEmptyState } from "@/features/dashboard/components/empty-state";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import { getEventPrimaryDateLabel } from "@/features/event/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface OrganizationEventOverviewProps {
  initialEvents: SerializedEvent[];
  workspaceName?: string | null;
}

export function OrganizationEventOverview({
  initialEvents,
  workspaceName,
}: OrganizationEventOverviewProps) {
  const events = initialEvents;

  const draftCount = events.filter((event) => event.status === "Draft").length;
  const publishedCount = events.filter((event) => event.status === "Published").length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Overview"
        title="Keep your organization workspace moving with clear next steps."
        description="This overview now reflects the active organization’s events, while forms and responses can keep evolving behind the same dashboard shell."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/dashboard/forms">Browse forms</Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard/events/new">Create Event</Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            title: "Draft events",
            value: String(draftCount).padStart(2, "0"),
            hint: "Draft events are still being shaped inside this organization.",
          },
          {
            title: "Published events",
            value: String(publishedCount).padStart(2, "0"),
            hint: "Published events are visible to attendees once discovery is ready.",
          },
          {
            title: "Total events",
            value: String(events.length).padStart(2, "0"),
            hint: "Every event in this dashboard belongs to the active workspace only.",
          },
          {
            title: "Active forms",
            value: events.length > 0 ? "TBD" : "00",
            hint: "Form and response counts can be wired after the event layer is settled.",
          },
        ].map((card) => (
          <Card
            key={card.title}
            className="rounded-[1.75rem] border-white/70 bg-white/90 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]"
          >
            <CardHeader className="px-5 pt-5">
              <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {card.title}
              </CardDescription>
              <CardTitle className="text-3xl font-semibold text-slate-950">
                {card.value}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 pt-0 text-sm leading-7 text-slate-600">
              {card.hint}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <CardDescription className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-900">
              Quick actions
            </CardDescription>
            <CardTitle className="text-2xl text-slate-950">
              Shape the core organization workflow
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 px-6 pb-6 pt-0 md:grid-cols-3">
            {[
              {
                title: "Create your next event",
                body: "Save a draft event into the active organization and continue setup from the event workspace.",
                href: "/dashboard/events/new",
                icon: Sparkles,
              },
              {
                title: "Review event list",
                body: "Only organization-owned events appear in the event index and detail pages.",
                href: "/dashboard/events",
                icon: FileStack,
              },
              {
                title: "Plan the response flow",
                body: "Responses can be layered in once forms and attendee submissions are modeled.",
                href: "/dashboard/responses",
                icon: Inbox,
              },
            ].map((action) => (
              <Link
                key={action.title}
                href={action.href}
                className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-5 transition hover:border-orange-200 hover:bg-white"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-orange-900 shadow-sm">
                  <action.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-slate-950">
                  {action.title}
                </h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  {action.body}
                </p>
                <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-orange-900">
                  Open
                  <ArrowRight className="h-4 w-4" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <CardDescription className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-900">
              Setup notes
            </CardDescription>
            <CardTitle className="text-2xl text-slate-950">
              What this workspace now knows
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {[
              {
                title: "Single active workspace",
                detail: "The dashboard reads the current organization from auth context and scopes event data to that workspace.",
                icon: FolderOpen,
              },
              {
                title: "Event-owned forms",
                detail: "Forms still live inside event workflows even if the aggregate forms route is not fully wired yet.",
                icon: ClipboardCheck,
              },
              {
                title: "Calm operator experience",
                detail: "The event data is real, but the layout still prioritizes clarity over dense admin tooling.",
                icon: WandSparkles,
              },
            ].map((note) => (
              <div
                key={note.title}
                className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm">
                    <note.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">
                      {note.title}
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-slate-600">
                      {note.detail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <CardDescription className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-900">
              Organization events
            </CardDescription>
            <CardTitle className="text-2xl text-slate-950">
              Recent event drafts and published work
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {events.length === 0 ? (
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5 text-sm text-slate-600">
                No events have been created for {workspaceName ?? "this workspace"} yet.
              </div>
            ) : (
              events.slice(0, 3).map((event) => (
                <div
                  key={event.id}
                  className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
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
                      <p className="text-sm text-slate-600">
                        {getEventPrimaryDateLabel(event)}
                      </p>
                    </div>
                    <Button asChild variant="outline" className="rounded-full">
                      <Link href={`/dashboard/events/${event.id}`}>Open event</Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <DashboardEmptyState
          icon={CalendarDays}
          title="Responses and schedule depth can come next"
          description="The low-hanging fruit here is real organization-scoped event visibility. Form and response surfaces can build on top of this foundation."
          primaryAction={{
            label: "Create Event",
            href: "/dashboard/events/new",
          }}
          secondaryAction={{
            label: "View Events",
            href: "/dashboard/events",
            variant: "outline",
          }}
          className="h-full justify-center bg-white/92"
        />
      </section>
    </div>
  );
}
