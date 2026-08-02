"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  FolderOpen,
  Mail,
  QrCode,
  Tags,
  Ticket,
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
import { DashboardEmptyState } from "@/features/dashboard/components/empty-state";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import {
  registrationStatValue,
  revenueStatPresentation,
  WorkspaceStatCard,
} from "@/features/dashboard/components/workspace-stat-card";
import type { WorkspaceSummary } from "@/features/dashboard/server/load-workspace-summary";
import { getEventPrimaryDateLabel, type SerializedEvent } from "@/features/event/utils";

type WorkspaceOverviewSummary = Omit<WorkspaceSummary, "quickActionEvent"> & {
  quickActionEvent: SerializedEvent | null;
};

interface OrganizationEventOverviewProps {
  initialEvents: SerializedEvent[];
  summary: WorkspaceOverviewSummary;
  workspaceName?: string | null;
}

const setupNotes = [
  {
    title: "Ticket types",
    detail: "Create typed offers for each event.",
  },
  {
    title: "Pricing & discount codes",
    detail: "Configure fees, promo codes, comped paths, and paid orders.",
  },
  {
    title: "Registration types & paths",
    detail: "Route attendees through the right application or checkout flow.",
  },
  {
    title: "Lifecycle emails",
    detail: "Send operational messages from event-specific email tools.",
  },
  {
    title: "On-site check-in / QR",
    detail: "Support arrival workflows from the event workspace.",
  },
  {
    title: "Reports",
    detail: "Review registrations and finance summaries per event.",
  },
];

export function OrganizationEventOverview({
  initialEvents,
  summary,
  workspaceName,
}: OrganizationEventOverviewProps) {
  const router = useRouter();
  const retry = () => router.refresh();
  const events = initialEvents;
  const quickActionEvent = summary.quickActionEvent;
  const registrationsErrored = "loadError" in summary.registrations;
  const revenueErrored = "loadError" in summary.revenue;
  const revenue = revenueStatPresentation(summary.revenue);

  const quickActions = quickActionEvent
    ? [
        {
          label: `Open "${quickActionEvent.name}"`,
          href: `/dashboard/events/${quickActionEvent.id}`,
          icon: FolderOpen,
          variant: "default" as const,
        },
        {
          label: "Add ticket types",
          href: `/dashboard/events/${quickActionEvent.id}/tickets`,
          icon: Ticket,
          variant: "outline" as const,
        },
        {
          label: "Set pricing & discounts",
          href: `/dashboard/events/${quickActionEvent.id}/pricing`,
          icon: Tags,
          variant: "outline" as const,
        },
        {
          label: "Configure emails",
          href: `/dashboard/events/${quickActionEvent.id}/emails`,
          icon: Mail,
          variant: "outline" as const,
        },
        {
          label: "Set up check-in",
          href: `/dashboard/events/${quickActionEvent.id}/checkin`,
          icon: QrCode,
          variant: "outline" as const,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Overview"
        title="Overview"
        description="Workspace-level event, registration, and paid revenue snapshots for the active organization."
        actions={
          <Button asChild>
            <Link href="/dashboard/events/new">Create Event</Link>
          </Button>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <WorkspaceStatCard
          title="Draft Events"
          value={String(summary.draftCount).padStart(2, "0")}
          hint="Draft events are still being shaped inside this organization."
        />
        <WorkspaceStatCard
          title="Published Events"
          value={String(summary.publishedCount).padStart(2, "0")}
          hint="Published events are visible to attendees once discovery is ready."
        />
        <WorkspaceStatCard
          title="Registrations"
          value={registrationStatValue(summary.registrations)}
          hint="Accepted attendees across every event in this workspace."
          errored={registrationsErrored}
          onRetry={retry}
        />
        <WorkspaceStatCard
          title="Revenue (paid)"
          value={revenue.value}
          hint={revenue.hint}
          secondary={revenue.secondary}
          tooltip={revenue.tooltip}
          errored={revenueErrored}
          onRetry={retry}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-2xl border-border bg-card py-0">
          <CardHeader className="px-6 pt-6">
            <CardDescription className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Quick actions
            </CardDescription>
            <CardTitle className="text-xl font-semibold tracking-tight text-foreground">
              Shape the core event workflow
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {quickActionEvent
                ? "Jump into the most recently updated event in this workspace."
                : "Create an event before opening event-specific workflows."}
            </p>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-0">
            {quickActionEvent ? (
              <div className="flex flex-wrap gap-3">
                {quickActions.map((action) => (
                  <Button
                    key={action.href}
                    asChild
                    variant={action.variant}
                    className="min-w-0 max-w-full justify-start"
                  >
                    <Link href={action.href} title={action.label}>
                      <action.icon aria-hidden="true" />
                      <span className="min-w-0 whitespace-normal text-left">
                        {action.label}
                      </span>
                    </Link>
                  </Button>
                ))}
              </div>
            ) : (
              <Button asChild>
                <Link href="/dashboard/events/new">Create your first event</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border bg-card py-0">
          <CardHeader className="px-6 pt-6">
            <CardDescription className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Setup notes
            </CardDescription>
            <CardTitle className="text-xl font-semibold tracking-tight text-foreground">
              What this workspace now handles
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Available across the active organization.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {setupNotes.map((note) => (
              <div key={note.title} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {note.title}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {note.detail}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-2xl border-border bg-card py-0">
          <CardHeader className="px-6 pt-6">
            <CardDescription className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Organization events
            </CardDescription>
            <CardTitle className="text-xl font-semibold tracking-tight text-foreground">
              Recent event drafts and published work
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {events.length === 0 ? (
              <div className="rounded-2xl border border-border bg-background p-5 text-sm text-muted-foreground">
                No events have been created for{" "}
                {workspaceName ?? "this workspace"} yet.
              </div>
            ) : (
              events.slice(0, 3).map((event) => (
                <div
                  key={event.id}
                  className="rounded-2xl border border-border bg-background p-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 break-words text-lg font-semibold text-foreground">
                          {event.name}
                        </h3>
                        <Badge variant="outline" className="rounded-full">
                          {event.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {getEventPrimaryDateLabel(event)}
                      </p>
                    </div>
                    <Button asChild variant="outline">
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
          title="Event operations live here"
          description="Create events, configure tickets and pricing, manage lifecycle emails, run check-in, and review reports from the event workspace."
          primaryAction={{
            label: "Create your first event",
            href: "/dashboard/events/new",
          }}
          secondaryAction={{
            label: "View Events",
            href: "/dashboard/events",
            variant: "outline",
          }}
          className="h-full justify-center border-border bg-card"
        />
      </section>
    </div>
  );
}
