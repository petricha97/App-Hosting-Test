import Link from "next/link";
import {
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Eye,
  FileStack,
  Inbox,
  LayoutTemplate,
  TriangleAlert,
} from "lucide-react";

import { DashboardEmptyState } from "@/features/dashboard/components/empty-state";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import {
  getEventPrimaryDateLabel,
  type SerializedEvent,
} from "@/features/event/utils";
import { EventRegistrationFormCard } from "@/features/form/components/event-registration-form-card";
import type { SerializedForm } from "@/features/form/utils";
import type { SerializedEventPage } from "@/features/event-pages/utils";
import { EventStatusActions } from "@/features/dashboard/components/event-status-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface OrganizationEventDetailProps {
  event: SerializedEvent | null;
  form: SerializedForm | null;
  eventPage: SerializedEventPage | null;
}

export function OrganizationEventDetail({
  event,
  form,
  eventPage,
}: OrganizationEventDetailProps) {
  if (!event) {
    return (
      <DashboardEmptyState
        icon={FileStack}
        title="Event not found in this organization"
        description="The requested event either does not exist or does not belong to the active workspace."
        primaryAction={{
          label: "Back to Events",
          href: "/dashboard/events",
        }}
        secondaryAction={{
          label: "Create Event",
          href: "/dashboard/events/new",
          variant: "outline",
        }}
        className="bg-white/92"
      />
    );
  }

  const readinessChecks =
    event.pageMode === "redirect"
      ? [
          {
            label: "Event is published",
            done: event.status === "Published",
            detail:
              event.status === "Published"
                ? "This event is visible to the public."
                : "Publish the event first so the public route can open it.",
          },
          {
            label: "Redirect URL is configured",
            done: Boolean(event.redirectUrl.trim()),
            detail: event.redirectUrl.trim()
              ? event.redirectUrl
              : "Add a redirect URL in Edit Event.",
          },
        ]
      : event.pageMode === "custom"
        ? [
            {
              label: "Event is published",
              done: event.status === "Published",
              detail:
                event.status === "Published"
                  ? "This event is visible to the public."
                  : "Publish the event first so the public route can open it.",
            },
            {
              label: "Custom page draft exists",
              done: Boolean(eventPage),
              detail: eventPage
                ? `Event page document ready: ${eventPage.title}`
                : "Open Page Builder and save a draft first.",
            },
            {
              label: "Custom page is published",
              done: eventPage?.status === "published",
              detail:
                eventPage?.status === "published"
                  ? "The public route can use the custom page layout."
                  : "Click Publish page in the page builder.",
            },
            {
              label: "Registration form is published",
              done: form?.status === "published",
              detail:
                form?.status === "published"
                  ? "The registration block can render publicly."
                  : form
                    ? "Open Form and publish it so the public page can show it."
                    : "No event form saved yet.",
            },
          ]
        : [
            {
              label: "Event is published",
              done: event.status === "Published",
              detail:
                event.status === "Published"
                  ? "This event is visible to the public."
                  : "Publish the event first so the public route can open it.",
            },
            {
              label: "Default page mode is active",
              done: event.pageMode === "default",
              detail:
                "The public route will use the generic default event page layout.",
            },
            {
              label: "Registration form is published",
              done: form?.status === "published",
              detail:
                form?.status === "published"
                  ? "The default public page can render the registration form."
                  : form
                    ? "Open Form and publish it so the public page can show it."
                    : "No event form saved yet.",
            },
          ];

  const completedChecks = readinessChecks.filter((item) => item.done).length;
  const isPublicExperienceReady = readinessChecks.every((item) => item.done);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Event overview"
        title={event.name}
        description={event.description}
        actions={
          <>
            <EventStatusActions eventId={event.id} status={event.status} />
            <Button asChild variant="outline">
              <Link href={`/dashboard/events/${event.id}/edit`}>Edit Event</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/dashboard/events/${event.id}/page-builder`}>
                Open Page Builder
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/dashboard/events/${event.id}/form`}>Open Form</Link>
            </Button>
            <Button asChild>
              <Link href={`/dashboard/events/${event.id}/responses`}>
                View Responses
              </Link>
            </Button>
          </>
        }
      />

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
                Public readiness
              </CardDescription>
              <CardTitle className="mt-2 text-2xl text-slate-950">
                Checklist for what the public page will actually use
              </CardTitle>
              <CardDescription className="mt-2 text-sm leading-7 text-slate-600">
                This makes it easier to spot why the public route is still
                falling back to the default page or hiding the form.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-orange-200 bg-white text-orange-900"
            >
              {completedChecks}/{readinessChecks.length} ready
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-6 pt-0">
          <div
            className={`rounded-[1.5rem] border p-4 ${
              isPublicExperienceReady
                ? "border-emerald-200 bg-emerald-50/80"
                : "border-amber-200 bg-amber-50/80"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl ${
                  isPublicExperienceReady
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-amber-100 text-amber-900"
                }`}
              >
                {isPublicExperienceReady ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <TriangleAlert className="h-5 w-5" />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  {isPublicExperienceReady
                    ? "The public route is ready to use the live experience."
                    : event.pageMode === "custom"
                      ? "The public route will stay on the default page until the checklist is complete."
                      : "The public route is still waiting on required publish steps."}
                </p>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Current mode:{" "}
                  <span className="font-medium capitalize text-slate-950">
                    {event.pageMode}
                  </span>
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {readinessChecks.map((item) => (
              <div
                key={item.label}
                className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl ${
                      item.done
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {item.done ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <CircleDashed className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      {item.label}
                    </p>
                    <p className="mt-2 break-all text-sm leading-7 text-slate-600">
                      {item.detail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
                Organization event identity
              </CardDescription>
              <CardTitle className="mt-2 text-3xl text-slate-950">
                {event.name}
              </CardTitle>
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-orange-200 bg-white text-orange-900"
            >
              {event.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 px-6 pb-6 pt-0 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["Schedule", getEventPrimaryDateLabel(event)],
            ["Capacity", `${event.expectedGuests} expected / ${event.capacity} max`],
            ["Timezone", event.timezone],
            [
              "Visibility",
              event.status === "Published"
                ? "Published event"
                : "Draft event workspace",
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                {label}
              </p>
              <p className="mt-3 text-sm leading-7 text-slate-700">{value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="grid gap-6 xl:grid-cols-3">
        {[
          {
            title: "Form builder",
            description:
              "Fields, structure, and helper text for this organization-owned event live in the dedicated builder route.",
            href: `/dashboard/events/${event.id}/form`,
            icon: FileStack,
          },
          {
            title: "Responses",
            description:
              "Submissions and review flow for this event live in the dedicated responses route.",
            href: `/dashboard/events/${event.id}/responses`,
            icon: Inbox,
          },
          {
            title: "Publish workflow",
            description:
              "This overview can now show the real event status, even before public discovery and promotion controls are wired in.",
            href: `/dashboard/events/${event.id}/responses`,
            icon: Eye,
          },
        ].map((item) => (
          <Card
            key={item.title}
            className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]"
          >
            <CardHeader className="px-6 pt-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                <item.icon className="h-5 w-5" />
              </div>
              <CardTitle className="text-2xl text-slate-950">
                {item.title}
              </CardTitle>
              <CardDescription className="text-sm leading-7 text-slate-600">
                {item.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-0">
              <Button asChild variant="outline" className="rounded-full">
                <Link href={item.href}>Open workspace</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
            Current event data
          </CardDescription>
          <CardTitle className="text-2xl text-slate-950">
            Real fields already available in the document
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 px-6 pb-6 pt-0 md:grid-cols-3">
          {[
            {
              icon: ClipboardList,
              title: "Organization path",
              body: event.organizationPath,
            },
            {
              icon: LayoutTemplate,
              title: "Page mode",
              body:
                event.pageMode === "redirect"
                  ? `Redirect to ${event.redirectUrl || "missing URL"}`
                  : event.pageMode === "custom"
                    ? "Custom event page builder is enabled."
                    : "Default public event page is enabled.",
            },
            {
              icon: Eye,
              title: "Overlap rule",
              body: event.allowOverlap
                ? "Scheduling overlap is allowed."
                : "Scheduling overlap is blocked.",
            },
          ].map((zone) => (
            <div
              key={zone.title}
              className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm">
                <zone.icon className="h-4 w-4" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-950">
                {zone.title}
              </h3>
              <p className="mt-2 break-all text-sm leading-7 text-slate-600">
                {zone.body}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <EventRegistrationFormCard
        eventId={event.id}
        eventName={event.name}
        form={form}
      />
    </div>
  );
}
