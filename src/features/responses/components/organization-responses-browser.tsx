"use client";

// Workspace responses browser (M3-T4 rework, design §4): prototype table
// with Ticket + Status columns, shared toolbar (search + status + count +
// export — review S6) plus the workspace-only event filter (the selects
// drive the Firestore query via URL params — no client status filtering)
// and the write:events-gated CSV export.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DashboardEmptyState } from "@/features/dashboard/components/empty-state";
import { downloadCsvExport } from "@/features/responses/download";
import {
  ResponsesFilteredEmptyState,
  ResponsesToolbar,
} from "@/features/responses/components/responses-toolbar";
import { ResponsesTable } from "@/features/responses/components/responses-table";
import type { SerializedResponse } from "@/features/responses/utils";
import { EntityTableError } from "@/features/registration/components/entity-table-states";
import type { FormDataStatus } from "@/types/collection";

const ALL_EVENTS = "all";

export interface ResponsesEventOption {
  id: string;
  name: string;
}

interface OrganizationResponsesBrowserProps {
  responses: SerializedResponse[];
  events: ResponsesEventOption[];
  workspaceName?: string | null;
  statusFilter?: FormDataStatus;
  eventFilter?: string;
  loadError: boolean;
}

export function OrganizationResponsesBrowser({
  responses,
  events,
  workspaceName,
  statusFilter,
  eventFilter,
  loadError,
}: OrganizationResponsesBrowserProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const pushFilters = (
    status: FormDataStatus | undefined,
    event: string | undefined,
  ) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (event) params.set("event", event);
    const query = params.toString();
    router.push(query ? `/dashboard/responses?${query}` : "/dashboard/responses");
  };

  const filteredResponses = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return responses;
    }
    return responses.filter((response) =>
      [
        response.attendeeName,
        response.attendeeEmail,
        response.eventName,
        response.ticketLabel ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [search, responses]);

  const hasActiveFilters =
    statusFilter !== undefined ||
    eventFilter !== undefined ||
    search.trim() !== "";

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (eventFilter) params.set("event", eventFilter);
      const query = params.toString();
      await downloadCsvExport(
        `/api/dashboard/responses/export${query ? `?${query}` : ""}`,
        "responses.csv",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {loadError ? (
        <EntityTableError
          entityLabel="responses"
          onRetry={() => router.refresh()}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <ResponsesToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search name, email, event or ticket"
            statusFilter={statusFilter}
            onStatusFilterChange={(status) => pushFilters(status, eventFilter)}
            count={filteredResponses.length}
            exporting={exporting}
            onExport={() => void exportCsv()}
          >
            <Select
              value={eventFilter ?? ALL_EVENTS}
              onValueChange={(value) =>
                pushFilters(
                  statusFilter,
                  value === ALL_EVENTS ? undefined : value,
                )
              }
            >
              <SelectTrigger className="w-44" aria-label="Filter by event">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_EVENTS}>All events</SelectItem>
                {events.map((event) => (
                  <SelectItem key={event.id} value={event.id}>
                    {event.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ResponsesToolbar>

          {filteredResponses.length === 0 ? (
            hasActiveFilters ? (
              <ResponsesFilteredEmptyState
                onClearFilters={() => {
                  setSearch("");
                  pushFilters(undefined, undefined);
                }}
              />
            ) : (
              <DashboardEmptyState
                icon={Inbox}
                title="No submissions have landed in this workspace yet"
                description={`Publish an event and its form for ${workspaceName ?? "this workspace"} to start collecting responses.`}
                primaryAction={{
                  label: "Open Events",
                  href: "/dashboard/events",
                }}
                secondaryAction={{
                  label: "Create Event",
                  href: "/dashboard/events/new",
                  variant: "outline",
                }}
                className="rounded-none border-0 bg-transparent"
              />
            )
          ) : (
            <ResponsesTable
              responses={filteredResponses}
              showEventColumn
            />
          )}
        </div>
      )}
    </div>
  );
}
