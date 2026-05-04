import Link from "next/link";
import { CalendarDays, Globe2, Ticket } from "lucide-react";

import type { SerializedEvent } from "@/features/event/utils";
import { getEventPrimaryDateLabel } from "@/features/event/utils";
import { EventRegistrationFormCard } from "@/features/form/components/event-registration-form-card";
import type { SerializedForm } from "@/features/form/utils";

interface PublicEventDetailProps {
  event: SerializedEvent;
  form: SerializedForm | null;
}

export function PublicEventDetail({ event, form }: PublicEventDetailProps) {
  return (
    <main className="min-h-screen bg-[#fff8f1] pb-20 pt-28 text-slate-900 sm:pt-32">
      <section className="mx-auto w-full max-w-screen-2xl space-y-10 px-4 sm:px-6 lg:px-8 2xl:max-w-[1760px]">
        <div className="space-y-4">
          <Link
            href="/events"
            className="inline-flex items-center rounded-full border border-orange-200 bg-white/85 px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-orange-300 hover:bg-white"
          >
            Back to events
          </Link>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-orange-900">
            Public event
          </p>
          <h1 className="max-w-5xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
            {event.name}
          </h1>
          <p className="max-w-3xl text-lg leading-8 text-slate-600">
            {event.description}
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="rounded-[2.5rem] border border-white/80 bg-white/90 p-6 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.4)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-900">
                  Event overview
                </p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-950">
                  Everything a guest needs at a glance
                </h2>
              </div>
              <div className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-950">
                Published
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {[
                ["Schedule", getEventPrimaryDateLabel(event)],
                ["Timezone", event.timezone],
                [
                  "Capacity",
                  `${event.expectedGuests} expected · ${event.capacity} max`,
                ],
                [
                  "Attendance rules",
                  event.allowOverlap
                    ? "Organizer allows overlapping schedule blocks."
                    : "Schedule blocks are kept separate by the organizer.",
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
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[2rem] border border-white/80 bg-white/90 p-6 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.4)]">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-900">
                <Ticket className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-2xl font-semibold text-slate-950">
                Registration ready
              </h3>
              <p className="mt-3 text-base leading-8 text-slate-600">
                Scroll down to complete the registration form when the organizer
                has published it.
              </p>
            </div>

            <div className="rounded-[2rem] border border-white/80 bg-white/90 p-6 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.4)]">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-900">
                <CalendarDays className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-2xl font-semibold text-slate-950">
                Generic presentation for now
              </h3>
              <p className="mt-3 text-base leading-8 text-slate-600">
                Public event pages intentionally stay simple in v1. A future CMS
                will let organizers add images, richer sections, and custom
                layouts.
              </p>
            </div>
          </div>
        </div>

        <EventRegistrationFormCard
          eventId={event.id}
          eventName={event.name}
          form={form}
          submitEndpoint={`/api/events/${event.id}/register`}
          heading={`Register for ${event.name}`}
          description="Complete the published registration form below. Your submission will be saved for the organizer to review."
          emptyTitle="Registration is not available yet"
          emptyDescription="This event is public, but the organizer has not published the registration form yet."
          submitLabel="Register now"
        />

        <div className="rounded-[2rem] border border-white/80 bg-white/85 p-6 text-sm leading-7 text-slate-600 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.4)]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-100 text-orange-900">
              <Globe2 className="h-4 w-4" />
            </div>
            <p className="font-semibold text-slate-950">Public event notes</p>
          </div>
          <p className="mt-4">
            This v1 public page only exposes published events and published forms.
            Draft organizer content remains private to the dashboard.
          </p>
        </div>
      </section>
    </main>
  );
}
