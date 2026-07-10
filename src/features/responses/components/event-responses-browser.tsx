"use client";

// Per-event responses browser (M3-T4, design §4): same table minus the Event
// column, shared toolbar (search + status filter + count + per-event CSV
// export — review S6), and cursor "load more" paging (limit 50, spec AC-9).
import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Inbox, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { downloadCsvExport } from "@/features/responses/download";
import {
  ResponsesFilteredEmptyState,
  ResponsesToolbar,
} from "@/features/responses/components/responses-toolbar";
import { ResponsesTable } from "@/features/responses/components/responses-table";
import type { SerializedResponse } from "@/features/responses/utils";
import { EntityTableError } from "@/features/registration/components/entity-table-states";
import type { FormDataStatus } from "@/types/collection";

interface EventResponsesBrowserProps {
  eventId: string;
  initialResponses: SerializedResponse[];
  statusFilter?: FormDataStatus;
  // True when the first page came back full — more rows may exist.
  initialHasMore: boolean;
  loadError: boolean;
}

function responseCursorMs(response: SerializedResponse): number | null {
  const iso = response.submittedAt?.isoString;
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function EventResponsesBrowser({
  eventId,
  initialResponses,
  statusFilter,
  initialHasMore,
  loadError,
}: EventResponsesBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  // Rows fetched by "load more" — appended below the server-rendered page.
  const [extraResponses, setExtraResponses] = useState<SerializedResponse[]>(
    [],
  );
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);

  const allResponses = useMemo(() => {
    // Guard against overlap if the server page refreshed underneath us.
    const seen = new Set(initialResponses.map((response) => response.id));
    return [
      ...initialResponses,
      ...extraResponses.filter((response) => !seen.has(response.id)),
    ];
  }, [initialResponses, extraResponses]);

  const filteredResponses = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return allResponses;
    }
    return allResponses.filter((response) =>
      [
        response.attendeeName,
        response.attendeeEmail,
        response.ticketLabel ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [search, allResponses]);

  const hasActiveFilters = statusFilter !== undefined || search.trim() !== "";

  const setStatusFilter = (value: FormDataStatus | undefined) => {
    setExtraResponses([]);
    router.push(
      value === undefined
        ? pathname
        : `${pathname}?status=${encodeURIComponent(value)}`,
    );
  };

  const loadMore = async () => {
    const last = allResponses[allResponses.length - 1];
    const cursor = last ? responseCursorMs(last) : null;
    if (cursor === null) {
      setHasMore(false);
      return;
    }

    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ cursor: String(cursor) });
      if (statusFilter) params.set("status", statusFilter);
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/responses?${params.toString()}`,
      );
      if (!response.ok) {
        toast.error("Failed to load more responses.");
        return;
      }

      const data = (await response.json()) as {
        responses: SerializedResponse[];
        hasMore: boolean;
      };
      setExtraResponses((current) => [...current, ...data.responses]);
      setHasMore(data.hasMore);
    } catch {
      toast.error("Failed to load more responses.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const query = params.toString();
      await downloadCsvExport(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/responses/export${query ? `?${query}` : ""}`,
        `responses-${eventId}.csv`,
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Responses</h1>
          <p className="text-sm text-muted-foreground">
            Registrations submitted for this event, newest first. Accepting a
            response is what mints the attendee record (arriving in M5).
          </p>
        </div>
      </div>

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
            searchPlaceholder="Search name, email or ticket"
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            count={filteredResponses.length}
            exporting={exporting}
            onExport={() => void exportCsv()}
          />

          {filteredResponses.length === 0 ? (
            hasActiveFilters ? (
              <ResponsesFilteredEmptyState
                onClearFilters={() => {
                  setSearch("");
                  setStatusFilter(undefined);
                }}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Inbox aria-hidden="true" className="h-6 w-6" />
                </div>
                <p className="text-sm font-semibold text-foreground">
                  No responses yet
                </p>
                <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                  Publish this event&apos;s registration form to start
                  collecting responses.
                </p>
              </div>
            )
          ) : (
            <ResponsesTable
              responses={filteredResponses}
              showEventColumn={false}
            />
          )}
        </div>
      )}

      {!loadError && hasMore && filteredResponses.length > 0 ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
