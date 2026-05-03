import Link from "next/link";
import { CalendarClock, FileStack, Globe, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";

export default function DashboardCreateEventPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Create event"
        title="A dedicated workspace replaces the raw test form."
        description="This route is the high-level event creation flow. It is intentionally structured into product sections so the final form, builder, and publish logic can evolve without changing the overall workspace design."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/dashboard/events">Back to Events</Link>
            </Button>
            <Button>Save draft</Button>
          </>
        }
      />

      <section className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {[
            {
              title: "Event basics",
              description:
                "Name, status, short description, ownership, and event intent belong in this first section.",
              icon: Sparkles,
            },
            {
              title: "Schedule and timing",
              description:
                "Use this area for periods, timezone, overlap rules, and future multi-block scheduling UI.",
              icon: CalendarClock,
            },
            {
              title: "Registration form",
              description:
                "The event creation flow should clearly show whether a registration form already exists, needs to be created, or will be attached later.",
              icon: FileStack,
            },
            {
              title: "Visibility and publish flow",
              description:
                "Reserve a clear section for draft, preview, publish, and public listing controls.",
              icon: Globe,
            },
          ].map((section) => (
            <Card
              key={section.title}
              className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]"
            >
              <CardHeader className="px-6 pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                    <section.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl text-slate-950">
                      {section.title}
                    </CardTitle>
                    <CardDescription className="mt-2 text-sm leading-7 text-slate-600">
                      {section.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 px-6 pb-6 pt-0 md:grid-cols-2">
                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4 text-sm leading-7 text-slate-600">
                  Placeholder inputs, selectors, and helper text live here.
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4 text-sm leading-7 text-slate-600">
                  Validation messages, examples, and next-step cues live here.
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-6">
          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
                Workspace notes
              </CardDescription>
              <CardTitle className="text-2xl text-slate-950">
                What this route should own
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0 text-sm leading-7 text-slate-600">
              <p>
                This page should replace the current temporary `EventFormTest`
                experience and become the first-class entry point for event
                creation.
              </p>
              <p>
                It should stay flexible while fields like `formPath`,
                `organizationPath`, periods, and future publishing rules settle
                down.
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-slate-950 py-0 text-white shadow-[0_24px_60px_-42px_rgba(15,23,42,0.55)]">
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-2xl">Primary outcome</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0 text-sm leading-7 text-slate-200">
              <p>
                A user should be able to leave this route with a saved draft
                event and a clear next step into form setup or publishing.
              </p>
              <Button asChild className="rounded-full bg-white text-slate-950 hover:bg-orange-50">
                <Link href="/dashboard/forms">Explore form workflows</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
