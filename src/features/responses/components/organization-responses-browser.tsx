"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { Inbox, ListChecks, Search } from "lucide-react";

import { DashboardEmptyState } from "@/features/dashboard/components/empty-state";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import {
  getResponseSubmittedLabel,
  type SerializedResponse,
} from "@/features/responses/utils";
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

function ResponseCard({ response }: { response: SerializedResponse }) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-950">
              {response.attendeeName}
            </h3>
            <Badge
              variant="outline"
              className="rounded-full border-orange-200 bg-white text-orange-900"
            >
              Live submission
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600">{response.attendeeEmail}</p>
          <p className="mt-2 text-sm font-medium text-slate-700">
            {response.eventName}
          </p>
        </div>
        <Button asChild variant="outline" className="rounded-full">
          <Link href={`/dashboard/events/${response.eventId}/responses`}>Open event</Link>
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Submitted
          </span>
          <span className="mt-2 block">{getResponseSubmittedLabel(response)}</span>
        </div>
        <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Form ID
          </span>
          <span className="mt-2 block break-all">{response.formId}</span>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
        <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Response preview
        </span>
        {response.submissionPreview.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {response.submissionPreview.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2">This submission only contains the mandatory attendee fields.</p>
        )}
      </div>
    </div>
  );
}

interface OrganizationResponsesBrowserProps {
  initialResponses: SerializedResponse[];
  workspaceName?: string | null;
}

export function OrganizationResponsesBrowser({
  initialResponses,
  workspaceName,
}: OrganizationResponsesBrowserProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const filteredResponses = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return initialResponses;
    }

    return initialResponses.filter((response) =>
      [
        response.attendeeName,
        response.attendeeEmail,
        response.eventName,
        ...response.submissionPreview,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [deferredSearch, initialResponses]);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Responses"
        title="Track live submissions across the active workspace."
        description="This inbox now reads real FormData documents from Firestore and groups them under the current organization."
      />

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-xl text-slate-950">Response inbox controls</CardTitle>
          <CardDescription>
            Search attendees, events, or preview fields while the richer response workflow is still taking shape.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-0">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search attendee names, emails, event titles, or answers"
              className="h-11 rounded-full border-slate-200 bg-slate-50 pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {filteredResponses.length === 0 ? (
        <DashboardEmptyState
          icon={Inbox}
          title={
            initialResponses.length === 0
              ? "No submissions have landed in this workspace yet"
              : "No submissions match this search"
          }
          description={
            initialResponses.length === 0
              ? `Publish an event and its form for ${workspaceName ?? "this workspace"} to start collecting responses.`
              : "Try a broader search or open an event-specific responses page."
          }
          primaryAction={{
            label: "Open Events",
            href: "/dashboard/events",
          }}
          secondaryAction={{
            label: "Create Event",
            href: "/dashboard/events/new",
            variant: "outline",
          }}
          className="bg-white/92"
        />
      ) : (
        <div className="space-y-6">
          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
                Workspace responses
              </CardDescription>
              <CardTitle className="text-2xl text-slate-950">
                {filteredResponses.length} submission{filteredResponses.length === 1 ? "" : "s"} in{" "}
                {workspaceName ?? "the active workspace"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0">
              {filteredResponses.map((response) => (
                <ResponseCard key={response.id} response={response} />
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                  <ListChecks className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-2xl text-slate-950">
                    What comes next
                  </CardTitle>
                  <CardDescription>
                    This live inbox is a first step. Review states, CSV export, and submission detail drawers can grow here next.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        </div>
      )}
    </div>
  );
}
