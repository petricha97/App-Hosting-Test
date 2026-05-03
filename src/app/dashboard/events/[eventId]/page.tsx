import Link from "next/link";
import { ClipboardList, Eye, FileStack, Inbox, LayoutTemplate } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";

interface EventDetailPageProps {
  params: Promise<{ eventId: string }>;
}

export default async function DashboardEventDetailPage({
  params,
}: EventDetailPageProps) {
  const { eventId } = await params;
  const eventLabel = decodeURIComponent(eventId);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Event overview"
        title="One event, its registration flow, and its response surfaces."
        description="This route acts as the event hub. It will eventually connect metadata, scheduling, the event-owned form, and attendee submissions."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/dashboard/events/${eventId}/form`}>Open Form</Link>
            </Button>
            <Button asChild>
              <Link href={`/dashboard/events/${eventId}/responses`}>
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
                Placeholder event identity
              </CardDescription>
              <CardTitle className="mt-2 text-3xl text-slate-950">
                {eventLabel}
              </CardTitle>
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-orange-200 bg-white text-orange-900"
            >
              Draft
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 px-6 pb-6 pt-0 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["Form status", "Builder not finalized"],
            ["Responses", "No submissions yet"],
            ["Visibility", "Draft event workspace"],
            ["Schedule", "No blocks published"],
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
              "Fields, structure, and helper text for this event live in the dedicated builder route.",
            href: `/dashboard/events/${eventId}/form`,
            icon: FileStack,
          },
          {
            title: "Responses",
            description:
              "Submissions and review flow for this event live in the dedicated responses route.",
            href: `/dashboard/events/${eventId}/responses`,
            icon: Inbox,
          },
          {
            title: "Publish workflow",
            description:
              "This overview will later surface preview, status changes, and public discovery state.",
            href: `/dashboard/events/${eventId}/responses`,
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
            Future detail zones
          </CardDescription>
          <CardTitle className="text-2xl text-slate-950">
            Additional panels that can grow with the schema
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 px-6 pb-6 pt-0 md:grid-cols-3">
          {[
            {
              icon: ClipboardList,
              title: "Checklist",
              body: "Operational tasks, reminders, and readiness notes can surface here.",
            },
            {
              icon: LayoutTemplate,
              title: "Promotions and add-ons",
              body: "Discounts, invoices, or templates can be layered in later without changing the shell.",
            },
            {
              icon: Eye,
              title: "Preview states",
              body: "Public event preview and attendee-facing content can sit alongside core management controls.",
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
              <p className="mt-2 text-sm leading-7 text-slate-600">
                {zone.body}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
