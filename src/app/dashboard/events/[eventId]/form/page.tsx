import { Blocks, PanelLeftOpen, Settings2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";

interface EventFormBuilderPageProps {
  params: Promise<{ eventId: string }>;
}

export default async function DashboardEventFormBuilderPage({
  params,
}: EventFormBuilderPageProps) {
  const { eventId } = await params;
  const eventLabel = decodeURIComponent(eventId);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Event-owned form"
        title={`Form builder scaffold for ${eventLabel}`}
        description="This page is designed as a workspace canvas. On smaller screens it stacks into sections, and on larger screens it expands into builder-style columns."
      />

      <section className="grid gap-6 2xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                <PanelLeftOpen className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-2xl text-slate-950">
                  Field palette
                </CardTitle>
                <CardDescription>
                  The building blocks for event registration fields.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-6 pb-6 pt-0">
            {["Short text", "Long text", "Email", "Phone", "Checkboxes"].map(
              (field) => (
                <div
                  key={field}
                  className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm font-medium text-slate-700"
                >
                  {field}
                </div>
              ),
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                <Blocks className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-2xl text-slate-950">
                  Builder canvas
                </CardTitle>
                <CardDescription>
                  This is where the event registration flow will be assembled.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {[
              "Hero and instructions",
              "Attendee details",
              "Optional add-ons",
              "Consent and final confirmation",
            ].map((section) => (
              <div
                key={section}
                className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-5"
              >
                <p className="text-sm font-semibold text-slate-950">{section}</p>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Placeholder space for field groups, ordering controls, and
                  future preview states.
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                <Settings2 className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-2xl text-slate-950">
                  Field settings
                </CardTitle>
                <CardDescription>
                  Labels, help text, validation, and rules will live here.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-6 pb-6 pt-0 text-sm leading-7 text-slate-600">
            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
              Required toggle, placeholder text, and helper copy.
            </div>
            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
              Future conditional logic and visibility rules.
            </div>
            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
              Preview and save behavior for the current selected field.
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
