"use client";

// Ticket Types screen (M1-T2): header + CTA, note banner, toolbar (search +
// registration-type filter + live count badge), table with derived Sales
// window / Open cells, create/edit dialog, and delete confirm.
// Filtering is client-side over the fetched page: search matches name or code
// (case-insensitive substring), the type filter uses contains-or-empty
// semantics (unrestricted tickets are eligible for every type), and both
// compose with AND.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Search, Ticket, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeleteEntityDialog } from "@/features/registration/components/delete-entity-dialog";
import {
  EntityEmptyState,
  EntityTableError,
} from "@/features/registration/components/entity-table-states";
import { InfoNote } from "@/features/registration/components/info-note";
import { TicketTypeDialog } from "@/features/registration/components/ticket-type-dialog";
import type {
  SerializedRegistrationType,
  SerializedTicketType,
} from "@/features/registration/types";
import {
  getSalesWindowLabel,
  isTicketOpen,
} from "@/features/registration/utils";

const ALL_TYPES = "all";

interface TicketTypesWorkspaceProps {
  eventId: string;
  tickets: SerializedTicketType[];
  registrationTypes: SerializedRegistrationType[];
  // Resolved event timezone for sales-window rendering.
  timeZone: string;
  loadError: boolean;
}

export function TicketTypesWorkspace({
  eventId,
  tickets,
  registrationTypes,
  timeZone,
  loadError,
}: TicketTypesWorkspaceProps) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SerializedTicketType | null>(null);
  const [deleting, setDeleting] = useState<SerializedTicketType | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const refresh = () => router.refresh();
  const nowMs = Date.now();
  const pricingHref = `/dashboard/events/${encodeURIComponent(eventId)}/pricing`;

  const filteredTickets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const matchesQuery =
        query === "" ||
        ticket.name.toLowerCase().includes(query) ||
        ticket.code.toLowerCase().includes(query);
      const matchesType =
        typeFilter === ALL_TYPES ||
        ticket.registrationTypeIds.length === 0 ||
        ticket.registrationTypeIds.includes(typeFilter);
      return matchesQuery && matchesType;
    });
  }, [tickets, search, typeFilter]);

  const isFiltered = search.trim() !== "" || typeFilter !== ALL_TYPES;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (ticket: SerializedTicketType) => {
    setEditing(ticket);
    setDialogOpen(true);
  };

  const openDelete = (ticket: SerializedTicketType) => {
    setDeleting(ticket);
    // Spec BLOCK rule: tickets with registrations can never be deleted.
    setDeleteBlocked(
      ticket.registeredCount > 0
        ? `${ticket.registeredCount} ${
            ticket.registeredCount === 1 ? "person is" : "people are"
          } registered with this ticket. Ticket types with registrations cannot be deleted.`
        : null,
    );
  };

  const clearFilters = () => {
    setSearch("");
    setTypeFilter(ALL_TYPES);
  };

  const confirmDelete = async () => {
    if (!deleting) return;

    setDeletePending(true);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/tickets/${encodeURIComponent(deleting.id)}`,
        { method: "DELETE" },
      );

      if (response.ok) {
        toast.success("Ticket type deleted");
        setDeleting(null);
        refresh();
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      if (response.status === 409 && typeof data?.error === "string") {
        setDeleteBlocked(data.error);
        return;
      }

      toast.error(
        typeof data?.error === "string"
          ? data.error
          : "Failed to delete the ticket type.",
      );
    } catch {
      // Network failure — toast and keep the confirm dialog open for a retry
      // (repo convention, see event-promotion-manager.tsx).
      toast.error("Failed to delete the ticket type.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setDeletePending(false);
    }
  };

  // Full ISO window for the cell tooltip (both bounds are UTC instants).
  const windowTitle = (ticket: SerializedTicketType) => {
    const parts = [
      ticket.salesStartMs != null
        ? `from ${new Date(ticket.salesStartMs).toISOString()}`
        : null,
      ticket.salesEndMs != null
        ? `until ${new Date(ticket.salesEndMs).toISOString()}`
        : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : undefined;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ticket types</h1>
          <p className="text-sm text-muted-foreground">
            What an attendee registers as. Each ticket has its own code,
            capacity and open window; price lives in{" "}
            <Link
              href={pricingHref}
              className="text-primary underline-offset-4 hover:underline"
            >
              Pricing
            </Link>
            .
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus aria-hidden="true" />
          Create ticket type
        </Button>
      </div>

      <InfoNote>
        <b>New concept vs a single-form model:</b> an event sells many{" "}
        <b>typed tickets</b> (Cvent&apos;s &ldquo;Admission Item&rdquo;).
        Fields shown to the buyer are still driven by your form.
      </InfoNote>

      {loadError ? (
        <EntityTableError entityLabel="ticket types" onRetry={refresh} />
      ) : tickets.length === 0 ? (
        <EntityEmptyState
          icon={Ticket}
          title="No ticket types yet"
          description="Create admission items like early bird, standard, and comp tickets. Pricing comes next."
          actionLabel="+ Create ticket type"
          onAction={openCreate}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <div className="relative max-w-xs flex-1 basis-56">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tickets…"
                aria-label="Search tickets"
                className="pl-9"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger
                aria-label="Filter by registration type"
                className="w-56"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TYPES}>
                  All registration types
                </SelectItem>
                {registrationTypes.map((registrationType) => (
                  <SelectItem
                    key={registrationType.id}
                    value={registrationType.id}
                  >
                    {registrationType.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="flex-1" />
            <span aria-live="polite">
              <Badge variant="secondary" className="rounded-full tabular-nums">
                {tickets.length} {tickets.length === 1 ? "ticket" : "tickets"}
                {isFiltered ? ` · ${filteredTickets.length} shown` : ""}
              </Badge>
            </span>
          </div>

          {filteredTickets.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">
                No tickets match your filters
              </p>
              <Button variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <Table aria-label="Ticket types" className="min-w-[52rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-48">Ticket</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Sales window</TableHead>
                  <TableHead>Open</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTickets.map((ticket) => {
                  const open = isTicketOpen(ticket, nowMs);
                  return (
                    <TableRow key={ticket.id}>
                      <TableCell className="font-medium text-foreground">
                        {ticket.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {ticket.code}
                      </TableCell>
                      <TableCell>
                        {/* Fees land in M2 — no price is stored on the ticket. */}
                        <Link
                          href={pricingHref}
                          title="Set in Pricing (coming in M2)"
                          aria-label="Set in Pricing (coming in M2)"
                          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        >
                          —
                        </Link>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {ticket.registeredCount}
                      </TableCell>
                      <TableCell>
                        {ticket.capacity === null
                          ? "Unlimited"
                          : ticket.capacity}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground"
                        title={windowTitle(ticket)}
                      >
                        {getSalesWindowLabel(ticket, { timeZone, nowMs })}
                      </TableCell>
                      <TableCell>
                        {open ? (
                          <Badge className="rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                            Yes
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="rounded-full">
                            No
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Edit ${ticket.name}`}
                            onClick={() => openEdit(ticket)}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${ticket.name}`}
                            onClick={() => openDelete(ticket)}
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
          )}
        </div>
      )}

      <TicketTypeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        ticketType={editing}
        registrationTypes={registrationTypes}
        timeZone={timeZone}
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
        title={`Delete ${deleting?.name ?? "ticket type"}?`}
        description="This permanently removes the ticket type."
        blockedMessage={deleteBlocked}
        pending={deletePending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
