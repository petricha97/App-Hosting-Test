"use client";

import Link from "next/link";
import { Render, type Data } from "@measured/puck";
import "@measured/puck/puck.css";

import type { SerializedEvent } from "@/features/event/utils";
import type { SerializedForm } from "@/features/form/utils";
import {
  createEventPagePuckConfig,
  createPublicRegistrationRenderer,
} from "@/features/event-pages/puck";
import type { SerializedEventPage } from "@/features/event-pages/utils";
import { Badge } from "@/components/ui/badge";

interface PublicCustomEventPageProps {
  event: SerializedEvent;
  form: SerializedForm | null;
  eventPage: SerializedEventPage;
}

export function PublicCustomEventPage({
  event,
  form,
  eventPage,
}: PublicCustomEventPageProps) {
  const config = createEventPagePuckConfig({
    registrationRender: createPublicRegistrationRenderer({
      eventId: event.id,
      eventName: event.name,
      form,
    }),
  });

  return (
    <main className="min-h-screen bg-[#fff8f1] pb-20 pt-28 text-slate-900 sm:pt-32">
      <section className="mx-auto w-full max-w-screen-2xl space-y-8 px-4 sm:px-6 lg:px-8 2xl:max-w-[1760px]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-3">
            <Link
              href="/events"
              className="inline-flex items-center rounded-full border border-orange-200 bg-white/85 px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-orange-300 hover:bg-white"
            >
              Back to events
            </Link>
            <Badge className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-900 shadow-none">
              Custom event page
            </Badge>
          </div>
          <div className="text-right text-sm leading-7 text-slate-600">
            <p className="font-semibold text-slate-950">{event.name}</p>
            <p>{event.timezone}</p>
          </div>
        </div>

        <div className="space-y-6">
          <Render
            config={config}
            data={
              (eventPage.publishedContent ?? eventPage.draftContent) as Data
            }
          />
        </div>
      </section>
    </main>
  );
}
