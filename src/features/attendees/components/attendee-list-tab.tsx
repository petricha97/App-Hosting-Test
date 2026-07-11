"use client";

// "Attendee list" tab (M5-T2, design §1): toolbar + merged roster table +
// register dialog + cursor "load more". Search and the status filter are
// client-side over the loaded rows (bounded lists per M3 convention — server
// search is an M8 candidate); load-more and CSV export forward the active
// filter so fetched pages and files match the view.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AttendeesTable } from "@/features/attendees/components/attendees-table";
import { AttendeesToolbar } from "@/features/attendees/components/attendees-toolbar";
import { RegisterAttendeeDialog } from "@/features/attendees/components/register-attendee-dialog";
import type {
  RosterRowStatus,
  SerializedAttendeeRow,
} from "@/features/attendees/roster";
import { downloadCsvExport } from "@/features/responses/download";
import { ResponsesFilteredEmptyState } from "@/features/responses/components/responses-toolbar";
import { EntityTableError } from "@/features/registration/components/entity-table-states";
import type { FormFieldValues } from "@/features/form/schema";
import type { SerializedRegistrationPath } from "@/features/registration-paths/types";
import type {
  SerializedRegistrationType,
  SerializedTicketType,
} from "@/features/registration/types";

interface RosterPagePayload {
  rows: SerializedAttendeeRow[];
  attendeeCursorMs: number | null;
  pendingCursorMs: number | null;
  hasMoreAttendees: boolean;
  hasMorePending: boolean;
}

interface AttendeeListTabProps {
  eventId: string;
  acceptedCount: number;
  initialRows: SerializedAttendeeRow[];
  initialAttendeeCursorMs: number | null;
  initialPendingCursorMs: number | null;
  initialHasMoreAttendees: boolean;
  initialHasMorePending: boolean;
  paths: SerializedRegistrationPath[];
  tickets: SerializedTicketType[];
  registrationTypes: SerializedRegistrationType[];
  questionFields: FormFieldValues[];
  hasForm: boolean;
  loadError: boolean;
}

export function AttendeeListTab({
  eventId,
  acceptedCount,
  initialRows,
  initialAttendeeCursorMs,
  initialPendingCursorMs,
  initialHasMoreAttendees,
  initialHasMorePending,
  paths,
  tickets,
  registrationTypes,
  questionFields,
  hasForm,
  loadError,
}: AttendeeListTabProps) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    RosterRowStatus | undefined
  >(undefined);
  const [exporting, setExporting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Rows fetched by "load more" — appended below the server-rendered page.
  const [extraRows, setExtraRows] = useState<SerializedAttendeeRow[]>([]);
  const [attendeeCursorMs, setAttendeeCursorMs] = useState(
    initialAttendeeCursorMs,
  );
  const [pendingCursorMs, setPendingCursorMs] = useState(
    initialPendingCursorMs,
  );
  const [hasMoreAttendees, setHasMoreAttendees] = useState(
    initialHasMoreAttendees,
  );
  const [hasMorePending, setHasMorePending] = useState(initialHasMorePending);
  const [loadingMore, setLoadingMore] = useState(false);

  const allRows = useMemo(() => {
    // Guard against overlap if the server page refreshed underneath us.
    const seen = new Set(
      initialRows.map((row) => `${row.kind}-${row.id}`),
    );
    return [
      ...initialRows,
      ...extraRows.filter((row) => !seen.has(`${row.kind}-${row.id}`)),
    ];
  }, [initialRows, extraRows]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (!normalizedSearch) return true;
      return [row.name, row.email]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [allRows, search, statusFilter]);

  const hasActiveFilters = statusFilter !== undefined || search.trim() !== "";
  const hasMore =
    statusFilter === "accepted"
      ? hasMoreAttendees
      : statusFilter === "pending"
        ? hasMorePending
        : hasMoreAttendees || hasMorePending;

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (attendeeCursorMs !== null && statusFilter !== "pending") {
        params.set("attendeeCursor", String(attendeeCursorMs));
      }
      if (pendingCursorMs !== null && statusFilter !== "accepted") {
        params.set("pendingCursor", String(pendingCursorMs));
      }

      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/attendees?${params.toString()}`,
      );
      if (!response.ok) {
        toast.error("Failed to load more attendees.");
        return;
      }

      const data = (await response.json()) as RosterPagePayload;
      setExtraRows((current) => [...current, ...data.rows]);
      if (statusFilter !== "pending") {
        setAttendeeCursorMs(data.attendeeCursorMs ?? attendeeCursorMs);
        setHasMoreAttendees(data.hasMoreAttendees);
      }
      if (statusFilter !== "accepted") {
        setPendingCursorMs(data.pendingCursorMs ?? pendingCursorMs);
        setHasMorePending(data.hasMorePending);
      }
    } catch {
      toast.error("Failed to load more attendees.", {
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
        `/api/dashboard/events/${encodeURIComponent(eventId)}/attendees/export${query ? `?${query}` : ""}`,
        `attendees-${eventId}.csv`,
      );
    } finally {
      setExporting(false);
    }
  };

  if (loadError) {
    return (
      <EntityTableError
        entityLabel="attendees"
        onRetry={() => router.refresh()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <AttendeesToolbar
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          acceptedCount={acceptedCount}
          exporting={exporting}
          onExport={() => void exportCsv()}
          onRegister={() => setDialogOpen(true)}
        />

        {filteredRows.length === 0 ? (
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
                <Users aria-hidden="true" className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                No attendees yet
              </p>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                Share your registration link to start filling the room.
              </p>
              <Button onClick={() => setDialogOpen(true)}>
                + Register attendee
              </Button>
            </div>
          )
        ) : (
          <AttendeesTable rows={filteredRows} />
        )}
      </div>

      {hasMore && filteredRows.length > 0 ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            Load more
          </Button>
        </div>
      ) : null}

      <RegisterAttendeeDialog
        eventId={eventId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        paths={paths}
        tickets={tickets}
        registrationTypes={registrationTypes}
        questionFields={questionFields}
        hasForm={hasForm}
        onRegistered={() => router.refresh()}
      />
    </div>
  );
}
