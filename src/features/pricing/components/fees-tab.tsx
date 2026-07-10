"use client";

// Fees tab (M2-T1): CTA row + count badge, comp-convention InfoNote, table
// with the 5 spec columns (Fee name | Ticket | Registration type | Base price
// | Status), row actions Edit / Archive / Delete, create-edit dialog, and the
// delete confirm with the order-reference BLOCK message.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, CircleDollarSign, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FeeDialog } from "@/features/pricing/components/fee-dialog";
import type { SerializedFee } from "@/features/pricing/types";
import { formatFeePrice } from "@/features/pricing/utils";
import { DeleteEntityDialog } from "@/features/registration/components/delete-entity-dialog";
import {
  EntityEmptyState,
  EntityTableError,
} from "@/features/registration/components/entity-table-states";
import { InfoNote } from "@/features/registration/components/info-note";
import type {
  SerializedRegistrationType,
  SerializedTicketType,
} from "@/features/registration/types";

interface FeesTabProps {
  eventId: string;
  fees: SerializedFee[];
  tickets: SerializedTicketType[];
  registrationTypes: SerializedRegistrationType[];
  loadError: boolean;
}

export function FeesTab({
  eventId,
  fees,
  tickets,
  registrationTypes,
  loadError,
}: FeesTabProps) {
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SerializedFee | null>(null);
  const [deleting, setDeleting] = useState<SerializedFee | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const refresh = () => router.refresh();
  const hasTickets = tickets.length > 0;
  const ticketsHref = `/dashboard/events/${encodeURIComponent(eventId)}/tickets`;

  const ticketCodeById = useMemo(
    () => new Map(tickets.map((ticket) => [ticket.id, ticket.code])),
    [tickets],
  );
  const registrationTypeNameById = useMemo(
    () => new Map(registrationTypes.map((type) => [type.id, type.name])),
    [registrationTypes],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (fee: SerializedFee) => {
    setEditing(fee);
    setDialogOpen(true);
  };

  const feeItemUrl = (feeId: string) =>
    `/api/dashboard/events/${encodeURIComponent(eventId)}/pricing/fees/${encodeURIComponent(feeId)}`;

  // Archive/restore = a status-flipped full PATCH (the item route validates
  // references + uniqueness; restoring into a duplicate combination 409s).
  const toggleArchive = async (fee: SerializedFee) => {
    const restoring = fee.status === "archived";
    setArchivingId(fee.id);
    try {
      const response = await fetch(feeItemUrl(fee.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fee.name,
          ticketTypeId: fee.ticketTypeId,
          registrationTypeId: fee.registrationTypeId,
          currency: fee.currency,
          basePriceMinor: fee.basePriceMinor,
          status: restoring ? "active" : "archived",
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        toast.error(
          typeof data?.error === "string"
            ? data.error
            : `Failed to ${restoring ? "restore" : "archive"} the fee.`,
        );
        return;
      }

      toast.success(restoring ? "Fee restored" : "Fee archived");
      refresh();
    } catch {
      toast.error(`Failed to ${restoring ? "restore" : "archive"} the fee.`, {
        description: "Check your connection and try again.",
      });
    } finally {
      setArchivingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;

    setDeletePending(true);
    try {
      const response = await fetch(feeItemUrl(deleting.id), {
        method: "DELETE",
      });

      if (response.ok) {
        toast.success("Fee deleted");
        setDeleting(null);
        refresh();
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      if (response.status === 409 && typeof data?.error === "string") {
        // Referenced by orders — the dialog flips to the blocked mode.
        setDeleteBlocked(data.error);
        return;
      }

      toast.error(
        typeof data?.error === "string" ? data.error : "Failed to delete the fee.",
      );
    } catch {
      toast.error("Failed to delete the fee.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span aria-live="polite">
          <Badge variant="secondary" className="rounded-full tabular-nums">
            {fees.length} {fees.length === 1 ? "fee" : "fees"}
          </Badge>
        </span>
        <Button onClick={openCreate} disabled={!hasTickets}>
          <Plus aria-hidden="true" />
          Create fee
        </Button>
      </div>

      <InfoNote>
        Same ticket can carry different prices per registration type and
        currency. Comp variants use ticket-code suffixes —{" "}
        <span className="font-mono">/C</span> client comp,{" "}
        <span className="font-mono">/S</span> staff comp.
      </InfoNote>

      {loadError ? (
        <EntityTableError entityLabel="fees" onRetry={refresh} />
      ) : fees.length === 0 ? (
        <EntityEmptyState
          icon={CircleDollarSign}
          title="No fees yet"
          description={
            hasTickets
              ? "Attach a price to each ticket — per registration type and currency."
              : "Attach a price to each ticket — per registration type and currency. Create tickets first if you haven't."
          }
          actionLabel={hasTickets ? "+ Create fee" : "Create ticket types"}
          onAction={hasTickets ? openCreate : () => router.push(ticketsHref)}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table aria-label="Fees" className="min-w-[56rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-48">Fee name</TableHead>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Registration type</TableHead>
                  <TableHead className="text-right">Base price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fees.map((fee) => {
                  const archived = fee.status === "archived";
                  return (
                    <TableRow key={fee.id}>
                      <TableCell className="font-medium text-foreground">
                        {fee.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {ticketCodeById.get(fee.ticketTypeId) ?? "—"}
                      </TableCell>
                      <TableCell>
                        {fee.registrationTypeId === null ? (
                          <span className="text-muted-foreground">
                            All types
                          </span>
                        ) : (
                          (registrationTypeNameById.get(fee.registrationTypeId) ??
                          "—")
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatFeePrice(fee.basePriceMinor, fee.currency)}
                      </TableCell>
                      <TableCell>
                        {archived ? (
                          <Badge variant="secondary" className="rounded-full">
                            Archived
                          </Badge>
                        ) : (
                          <Badge className="rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                            Active
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Edit ${fee.name}`}
                            onClick={() => openEdit(fee)}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={
                              archived
                                ? `Restore ${fee.name}`
                                : `Archive ${fee.name}`
                            }
                            disabled={archivingId === fee.id}
                            onClick={() => toggleArchive(fee)}
                          >
                            {archived ? (
                              <ArchiveRestore aria-hidden="true" />
                            ) : (
                              <Archive aria-hidden="true" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${fee.name}`}
                            onClick={() => {
                              setDeleteBlocked(null);
                              setDeleting(fee);
                            }}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <FeeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        fee={editing}
        tickets={tickets}
        registrationTypes={registrationTypes}
        onSaved={refresh}
      />

      <DeleteEntityDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setDeleteBlocked(null);
          }
        }}
        title={`Delete ${deleting?.name ?? "fee"}?`}
        description="This permanently removes the fee. Tickets priced by it revert to no price."
        blockedMessage={deleteBlocked}
        pending={deletePending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
