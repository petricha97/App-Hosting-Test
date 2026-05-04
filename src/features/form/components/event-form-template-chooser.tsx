"use client";

import Link from "next/link";
import {
  CopyPlus,
  FileStack,
  Sparkles,
} from "lucide-react";

import type { SerializedFormTemplate } from "@/features/form/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";

interface EventFormTemplateChooserProps {
  eventId: string;
  eventName: string;
  templates: SerializedFormTemplate[];
}

export function EventFormTemplateChooser({
  eventId,
  eventName,
  templates,
}: EventFormTemplateChooserProps) {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Event form setup"
        title={`Choose how to start the registration form for ${eventName}.`}
        description="Use a reusable template from your workspace, or begin from scratch with the default mandatory attendee fields."
        actions={
          <Button asChild variant="outline">
            <Link href={`/dashboard/events/${eventId}`}>Back to event</Link>
          </Button>
        }
      />

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                <CopyPlus className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-2xl text-slate-950">
                  Start from a template
                </CardTitle>
                <CardDescription>
                  Templates keep recurring registration patterns reusable across the workspace.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {templates.length ? (
              templates.map((template) => (
                <div
                  key={template.id}
                  className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">
                        {template.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {template.description || "No description yet."}
                      </p>
                    </div>
                    <Button asChild className="rounded-full">
                      <Link
                        href={`/dashboard/events/${eventId}/form?templateId=${template.id}`}
                      >
                        Use template
                      </Link>
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                    <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                      {template.fields.length} fields
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                      Version {template.version}
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                      {template.status}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-600">
                No active templates yet. You can still start from scratch now and add templates later under the Forms area.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border-white/70 bg-slate-950 py-0 text-white shadow-[0_24px_60px_-42px_rgba(15,23,42,0.55)]">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-orange-100">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-2xl">Start from scratch</CardTitle>
                <CardDescription className="text-slate-300">
                  Use the default attendee fields and build this event form from the ground up.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0 text-sm leading-7 text-slate-200">
            <p>
              Scratch forms begin with first name, last name, and email. From there, the organizer can add extra custom fields and publish when ready.
            </p>
            <Button
              asChild
              className="rounded-full bg-white text-slate-950 hover:bg-orange-50"
            >
              <Link href={`/dashboard/events/${eventId}/form?mode=scratch`}>
                Start from scratch
              </Link>
            </Button>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-orange-100">
                <FileStack className="h-4 w-4" />
                <p className="text-sm font-semibold">Template-friendly flow</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Once the first event form exists, you can keep using it directly or move to shared templates for repeated registration patterns.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
