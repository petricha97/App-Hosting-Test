"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import {
  CalendarRange,
  Filter,
  LayoutGrid,
  List,
  Search,
  TicketPlus,
} from "lucide-react";

import type { SerializedEvent } from "@/features/event/utils";
import { getEventPrimaryDateLabel } from "@/features/event/utils";
import { DashboardEmptyState } from "@/features/dashboard/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function EventCard({ event }: { event: SerializedEvent }) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-950">{event.name}</h3>
            <Badge
              variant="outline"
              className="rounded-full border-orange-200 bg-white text-orange-900"
            >
              {event.status}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {getEventPrimaryDateLabel(event)}
          </p>
        </div>
        <Button asChild variant="outline" className="rounded-full">
          <Link href={`/dashboard/events/${event.id}`}>Open</Link>
        </Button>
      </div>
      <div className="mt-5 grid gap-3">
        <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Capacity
          </span>
          <span className="mt-2 block">
            {event.expectedGuests} expected · {event.capacity} max
          </span>
        </div>
      </div>
    </div>
  );
}

interface OrganizationEventsBrowserProps {
  initialEvents: SerializedEvent[];
  workspaceName?: string | null;
  showDebugPayload?: boolean;
}

type EventsViewMode = "cards" | "table";

export function OrganizationEventsBrowser({
  initialEvents,
  workspaceName,
  showDebugPayload = false,
}: OrganizationEventsBrowserProps) {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<EventsViewMode>("cards");
  const deferredSearch = useDeferredValue(search);
  const events = initialEvents;

  const normalizedSearch = deferredSearch.trim().toLowerCase();
  const filteredEvents = normalizedSearch
    ? events.filter((event) => {
        const haystack = [
          event.name,
          event.description,
          event.status,
          event.timezone,
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(normalizedSearch);
      })
    : events;

  return (
    <div className="space-y-6">
      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="flex flex-col gap-4 px-6 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-xl text-slate-950">Search</CardTitle>
          <Button asChild>
            <Link href="/dashboard/events/new">Create Event</Link>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 px-6 pb-6 pt-0 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search event names, descriptions, or statuses"
              className="h-11 rounded-full border-slate-200 bg-slate-50 pl-10"
            />
          </div>
          <Button variant="outline" className="h-11 rounded-full" disabled>
            <Filter className="mr-2 h-4 w-4" />
            Status
          </Button>
          <Button variant="outline" className="h-11 rounded-full" disabled>
            <CalendarRange className="mr-2 h-4 w-4" />
            Date range
          </Button>
          <div className="flex h-11 items-center rounded-full border border-slate-200 bg-slate-50 p-1">
            <Button
              type="button"
              variant={viewMode === "cards" ? "default" : "ghost"}
              size="sm"
              className="rounded-full"
              onClick={() => setViewMode("cards")}
            >
              <LayoutGrid className="mr-2 h-4 w-4" />
              Cards
            </Button>
            <Button
              type="button"
              variant={viewMode === "table" ? "default" : "ghost"}
              size="sm"
              className="rounded-full"
              onClick={() => setViewMode("table")}
            >
              <List className="mr-2 h-4 w-4" />
              Table
            </Button>
          </div>
        </CardContent>
      </Card>

      {filteredEvents.length === 0 ? (
        <DashboardEmptyState
          icon={TicketPlus}
          title={
            events.length === 0
              ? "This organization does not have any events yet"
              : "No events match this search"
          }
          description={
            events.length === 0
              ? `Create the first event for ${workspaceName ?? "this workspace"} and it will appear here.`
              : "Try a broader search or create a new event for this workspace."
          }
          primaryAction={{
            label: "Create Event",
            href: "/dashboard/events/new",
          }}
          secondaryAction={{
            label: "Clear search",
            href: "/dashboard/events",
            variant: "outline",
          }}
          className="bg-white/92"
        />
      ) : (
        <div className="space-y-6">
          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
                Organization events
              </CardDescription>
            </CardHeader>
            {viewMode === "cards" ? (
              <CardContent className="space-y-4 px-6 pb-6 pt-0">
                {filteredEvents.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </CardContent>
            ) : (
              <CardContent className="px-6 pb-6 pt-0">
                <div className="overflow-x-auto rounded-[1.5rem] border border-slate-200 bg-slate-50/80">
                  <Table aria-label="Organization events" className="min-w-[56rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-56">Event</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Capacity</TableHead>
                        <TableHead className="text-right">Open</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEvents.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="font-medium text-slate-950">
                            {event.name}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="rounded-full border-orange-200 bg-white text-orange-900"
                            >
                              {event.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-600">
                            {getEventPrimaryDateLabel(event)}
                          </TableCell>
                          <TableCell className="text-right text-slate-600">
                            {event.expectedGuests} expected · {event.capacity} max
                          </TableCell>
                          <TableCell className="text-right">
                            <Button asChild variant="outline" className="rounded-full">
                              <Link href={`/dashboard/events/${event.id}`}>Open</Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            )}
          </Card>

          {showDebugPayload ? (
            <Card className="rounded-[2rem] border-dashed border-slate-300 bg-slate-950 py-0 text-white shadow-[0_24px_60px_-42px_rgba(15,23,42,0.55)]">
              <CardHeader className="px-6 pt-6">
                <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-200">
                  Debug payload
                </CardDescription>
                <CardTitle className="text-2xl text-white">
                  Server-serialized event JSON
                </CardTitle>
              </CardHeader>
              <CardContent className="px-6 pb-6 pt-0">
                <pre className="overflow-x-auto rounded-[1.5rem] bg-black/30 p-4 text-xs leading-6 text-slate-200">
                  {JSON.stringify(filteredEvents, null, 2)}
                </pre>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
