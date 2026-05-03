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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { overviewSummaryCards, placeholderEvents } from "@/features/dashboard/mock-data";
import { DashboardEmptyState } from "@/features/dashboard/components/empty-state";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";

export default function DashboardOverviewPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Overview"
        title="Keep your workspace moving with clear next steps."
        description="Use the dashboard to create events, shape event-owned registration forms, and prepare response workflows before the underlying schema is fully finalized."
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
        {overviewSummaryCards.map((card) => (
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
              Shape the core event workflow
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 px-6 pb-6 pt-0 md:grid-cols-3">
            {[
              {
                title: "Create your first event",
                body: "Set the foundation for the event workspace, status, and schedule.",
                href: "/dashboard/events/new",
                icon: Sparkles,
              },
              {
                title: "Plan the registration form",
                body: "Decide what fields and attendee details the event should collect.",
                href: "/dashboard/forms",
                icon: FileStack,
              },
              {
                title: "Prepare the response flow",
                body: "Design how submissions will be reviewed once registrations open.",
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
              What v1 is centered around
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {[
              {
                title: "Single active workspace",
                detail: "The shell is designed around one active organization today, with room for switching later.",
                icon: FolderOpen,
              },
              {
                title: "Event-owned forms",
                detail: "Forms live inside event workflows even though the dashboard also offers aggregate form and response indexes.",
                icon: ClipboardCheck,
              },
              {
                title: "Calm operator experience",
                detail: "This dashboard prioritizes strong hierarchy, quick actions, and intentional empty states over dense admin tables.",
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
              Event preview
            </CardDescription>
            <CardTitle className="text-2xl text-slate-950">
              The workspace is ready for event cards, states, and actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {placeholderEvents.map((event) => (
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
                    <p className="text-sm text-slate-600">{event.dateLabel}</p>
                  </div>
                  <Button asChild variant="outline" className="rounded-full">
                    <Link href={`/dashboard/events/${event.id}`}>Open event</Link>
                  </Button>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                    <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Responses
                    </span>
                    <span className="mt-2 block">{event.responseLabel}</span>
                  </div>
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                    <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Form status
                    </span>
                    <span className="mt-2 block">{event.formStatus}</span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <DashboardEmptyState
          icon={CalendarDays}
          title="No live schedule yet"
          description="Published events, attendee responses, and upcoming blocks will all surface here once the workspace moves past the initial scaffold stage."
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
