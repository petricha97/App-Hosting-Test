"use client";

// Shared responses table (M3-T4, design §4): prototype columns
// Name · Email · [Event] · Ticket · Status · Submitted · actions.
// Owns the status-transition plumbing: optimistic badge update, rollback
// toast on failure, and the 409 "already updated — refreshing" surface.
// No bulk selection in M3 (decision — single-row menus keep accepts
// auditable; revisit with the M5 attendee lifecycle).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResponseActionsMenu } from "@/features/responses/components/response-actions-menu";
import { StatusBadge } from "@/features/responses/components/status-badge";
import { FORM_DATA_STATUS_LABELS } from "@/features/responses/status-utils";
import {
  getResponseSubmittedLabel,
  type SerializedResponse,
} from "@/features/responses/utils";
import type { FormDataStatus } from "@/types/collection";

interface ResponsesTableProps {
  responses: SerializedResponse[];
  // Workspace table shows the Event column (linking to the per-event page);
  // the per-event table drops it.
  showEventColumn: boolean;
}

export function ResponsesTable({
  responses,
  showEventColumn,
}: ResponsesTableProps) {
  const router = useRouter();

  // Optimistic status values — the badge flips immediately and rolls back
  // with a toast when the PATCH fails (design §4).
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, FormDataStatus>
  >({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const transition = async (
    response: SerializedResponse,
    to: FormDataStatus,
  ) => {
    setPendingId(response.id);
    setStatusOverrides((current) => ({ ...current, [response.id]: to }));

    const rollback = () =>
      setStatusOverrides((current) => {
        const next = { ...current };
        delete next[response.id];
        return next;
      });

    try {
      const result = await fetch(
        `/api/dashboard/events/${encodeURIComponent(response.eventId)}/responses/${encodeURIComponent(response.id)}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to }),
        },
      );

      if (result.ok) {
        toast.success(
          to === "accepted"
            ? "Response accepted"
            : `Marked as ${FORM_DATA_STATUS_LABELS[to].toLowerCase()}`,
        );
        router.refresh();
        return;
      }

      rollback();
      if (result.status === 409) {
        toast.error("This response was already updated — refreshing.");
        router.refresh();
        return;
      }

      const data = (await result.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      toast.error(
        typeof data?.error === "string"
          ? data.error
          : "Failed to update the response.",
      );
    } catch {
      rollback();
      toast.error("Failed to update the response.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="overflow-x-auto">
      <Table
        aria-label="Responses"
        className={showEventColumn ? "min-w-[64rem]" : "min-w-[52rem]"}
      >
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-40">Name</TableHead>
            <TableHead>Email</TableHead>
            {showEventColumn ? <TableHead>Event</TableHead> : null}
            <TableHead>Ticket</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {responses.map((response) => {
            const status = statusOverrides[response.id] ?? response.status;

            return (
              <TableRow key={response.id}>
                <TableCell className="font-medium text-foreground">
                  {response.attendeeName}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {response.attendeeEmail}
                </TableCell>
                {showEventColumn ? (
                  <TableCell>
                    <Link
                      href={`/dashboard/events/${encodeURIComponent(response.eventId)}/responses`}
                      className="underline-offset-4 hover:underline"
                    >
                      {response.eventName}
                    </Link>
                  </TableCell>
                ) : null}
                <TableCell>
                  {response.ticketLabel ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {getResponseSubmittedLabel(response)}
                </TableCell>
                <TableCell className="text-right">
                  <ResponseActionsMenu
                    attendeeName={response.attendeeName}
                    status={status}
                    disabled={pendingId === response.id}
                    onTransition={(to) => transition(response, to)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
