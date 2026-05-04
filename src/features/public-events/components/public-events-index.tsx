import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, Ticket } from "lucide-react";

import type { SerializedEvent } from "@/features/event/utils";
import { getEventPrimaryDateLabel } from "@/features/event/utils";

interface PublicEventsIndexProps {
  events: SerializedEvent[];
}

export function PublicEventsIndex({ events }: PublicEventsIndexProps) {
  return (
    <main className="min-h-screen bg-[#fff8f1] pb-20 pt-28 text-slate-900 sm:pt-32">
      <section className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8 2xl:max-w-[1760px]">
        <div className="max-w-4xl space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-orange-900">
            Public events
          </p>
          <h1 className="text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
            Browse what is already live and ready for guests.
          </h1>
          <p className="max-w-3xl text-lg leading-8 text-slate-600">
            Published events appear here automatically. Draft events stay private
            to the organizer workspace until they are ready for the public.
          </p>
        </div>

        {events.length === 0 ? (
          <div className="mt-12 rounded-[2.5rem] border border-white/80 bg-white/90 p-8 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.4)]">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-900">
              Nothing public yet
            </p>
            <h2 className="mt-3 text-3xl font-semibold text-slate-950">
              No published events are available right now.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600">
              Check back soon. As organizers publish events, they will appear
              here automatically.
            </p>
          </div>
        ) : (
          <div className="mt-12 grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
            {events.map((event) => (
              <article
                key={event.id}
                className="rounded-[2rem] border border-white/80 bg-white/90 p-6 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.4)] backdrop-blur"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-950">
                    Published event
                  </span>
                  <Ticket className="h-5 w-5 text-slate-400" />
                </div>

                <h2 className="mt-6 text-3xl font-semibold text-slate-950">
                  {event.name}
                </h2>
                <p className="mt-4 text-base leading-8 text-slate-600">
                  {event.description}
                </p>

                <div className="mt-6 space-y-3 text-sm text-slate-600">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-orange-900" />
                    <span>{getEventPrimaryDateLabel(event)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-orange-900" />
                    <span>{event.timezone}</span>
                  </div>
                </div>

                <div className="mt-6 rounded-[1.5rem] bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Capacity
                  </span>
                  <span className="mt-2 block">
                    {event.expectedGuests} expected · {event.capacity} max
                  </span>
                </div>

                <Link
                  href={`/events/${event.id}`}
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#ff7a59] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#f46a47]"
                >
                  View event
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
