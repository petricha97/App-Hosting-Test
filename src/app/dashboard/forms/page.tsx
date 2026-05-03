import Link from "next/link";
import { FileStack, PencilRuler } from "lucide-react";

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
import { placeholderForms } from "@/features/dashboard/mock-data";

export default function DashboardFormsPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Forms"
        title="Browse event-owned forms across the workspace."
        description="Forms stay attached to events in v1, but this aggregate page helps the team spot what already exists and what still needs structure."
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard/events/new">Create Event First</Link>
          </Button>
        }
      />

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
              Form index preview
            </CardDescription>
            <CardTitle className="text-2xl text-slate-950">
              Event-scoped forms can still be reviewed at the org level
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {placeholderForms.map((form) => (
              <div
                key={form.id}
                className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-950">
                        {form.name}
                      </h3>
                      <Badge
                        variant="outline"
                        className="rounded-full border-orange-200 bg-white text-orange-900"
                      >
                        {form.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {form.eventName}
                    </p>
                  </div>
                  <Button asChild variant="outline" className="rounded-full">
                    <Link href="/dashboard/events/design-breakfast/form">
                      Open builder
                    </Link>
                  </Button>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                    {form.fieldCount} planned fields
                  </div>
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                    {form.updatedLabel}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <DashboardEmptyState
          icon={FileStack}
          title="Forms remain anchored to events"
          description="This page is an aggregate index, not a standalone form library. The primary creation path still begins inside an event workspace."
          primaryAction={{
            label: "Create Event",
            href: "/dashboard/events/new",
          }}
          secondaryAction={{
            label: "Explore Events",
            href: "/dashboard/events",
            variant: "outline",
          }}
          className="bg-white/92"
        />
      </section>

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
              <PencilRuler className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-2xl text-slate-950">
                Builder expectations
              </CardTitle>
              <CardDescription>
                The event-owned form builder should eventually support field
                editing, ordering, preview, and conditional behavior.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
