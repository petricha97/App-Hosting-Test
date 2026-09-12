"use client";

// Ticket Types screen (M1-T2): header + CTA, note banner, toolbar (search +
// registration-type filter + live count badge), table with derived Sales
// window / Open cells, create/edit dialog, and delete confirm.
// Filtering is client-side over the fetched page: search matches name or code
// (case-insensitive substring), the type filter uses contains-or-empty
// semantics (unrestricted tickets are eligible for every type), and both
// compose with AND.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Loader2,
  Pause,
  Play,
  Pencil,
  Plus,
  Search,
  Ticket,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { SerializedFee } from "@/features/pricing/types";
import { getTicketPriceDisplay } from "@/features/pricing/utils";
import { DeleteEntityDialog } from "@/features/registration/components/delete-entity-dialog";
import {
  EntityEmptyState,
  EntityTableError,
} from "@/features/registration/components/entity-table-states";
import { TicketTypeDialog } from "@/features/registration/components/ticket-type-dialog";
import type {
  SerializedRegistrationType,
  SerializedTicketType,
} from "@/features/registration/types";
import {
  getSalesWindowLabel,
  getTicketOpenState,
} from "@/features/registration/utils";
import { CreateTicketWizard } from "@/features/ticket-wizard/components/create-ticket-wizard";

const ALL_TYPES = "all";

interface TicketTypesWorkspaceProps {
  eventId: string;
  tickets: SerializedTicketType[];
  registrationTypes: SerializedRegistrationType[];
  // The event's fees — the Price column derives its display from them
  // (M2-T1 AC-12): lowest active fee (+N more), "Comp" for 0, "—" when none.
  fees: SerializedFee[];
  // Resolved event timezone for sales-window rendering.
  timeZone: string;
  loadError: boolean;
}

// Combines manual sales controls, inclusive date windows, and quantity availability.
function getSalesStatus(
  ticket: SerializedTicketType,
  nowMs: number,
  hasPricing: boolean,
): string {
  const windowState = getTicketOpenState(ticket, nowMs);
  if (windowState === "closed-manual") return "Paused";
  if (windowState === "ended") return "Ended";
  if (windowState === "not-started") return "Scheduled";
  if (ticket.capacity !== null && ticket.registeredCount >= ticket.capacity)
    return "Sold out";
  return hasPricing ? "On sale" : "Needs pricing";
}

// Lists ticket inventory and manages sales availability without overwriting ticket details.
export function TicketTypesWorkspace({
  eventId,
  tickets,
  registrationTypes,
  fees,
  timeZone,
  loadError,
}: TicketTypesWorkspaceProps) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES);
  const [dialogOpen, setDialogOpen] = useState(false);
  // M9-T1: the wizard is now the PRIMARY "Create ticket" action; `dialogOpen`
  // (TicketTypeDialog) stays reachable as a secondary, unobtrusive option for
  // organizers who deliberately want the old unpriced create flow, and is
  // still the only path for editing an existing ticket (unchanged).
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<SerializedTicketType | null>(null);
  const [deleting, setDeleting] = useState<SerializedTicketType | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const [salesPending, setSalesPending] = useState<string | null>(null);
  const salesInFlight = useRef(false);
  const [salesOverrides, setSalesOverrides] = useState<Record<string, boolean>>(
    {},
  );
  const [salesError, setSalesError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now);

  // Server refreshes replace temporary successful sales changes with current inventory.
  useEffect(() => setSalesOverrides({}), [tickets]);
  // Keep scheduled/ended labels current while the organiser leaves the list open.
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Refreshes server-owned inventory after a successful mutation.
  const refresh = () => router.refresh();
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

  // Primary "Create ticket" action (M9-T1 OQ-1: wizard is primary, coexists
  // with the old dialog).
  const openWizard = () => setWizardOpen(true);

  // Secondary "Create ticket type only" action — the pre-M9 flow, reachable
  // via the header dropdown for organizers who deliberately want to skip
  // audience/pricing at creation time (e.g. bulk-scripted setups, spec OQ-1).
  const openCreateTicketOnly = () => {
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

  // Sends only the desired sales flag, preserving newer dates, names, and quantity changes.
  const toggleSales = async (ticket: SerializedTicketType) => {
    if (salesInFlight.current) return;
    salesInFlight.current = true;
    setSalesPending(ticket.id);
    setSalesError(null);
    const nextIsOpen = !ticket.isOpen;
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/tickets/${encodeURIComponent(ticket.id)}/sales`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isOpen: nextIsOpen }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        ticketTypeId?: string;
        isOpen?: boolean;
        error?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Failed to update ticket sales.",
        );
      }
      if (
        data?.ticketTypeId !== ticket.id ||
        typeof data.isOpen !== "boolean"
      ) {
        throw new Error(
          "Could not confirm the sales update. Refresh and try again.",
        );
      }
      setSalesOverrides((current) => ({
        ...current,
        [ticket.id]: data.isOpen as boolean,
      }));
      toast.success(
        nextIsOpen ? "Ticket sales resumed" : "Ticket sales paused",
        nextIsOpen
          ? {
              description:
                "Sales dates and ticket quantity limits still apply.",
            }
          : undefined,
      );
      refresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update ticket sales.";
      setSalesError(message);
      toast.error(message);
    } finally {
      salesInFlight.current = false;
      setSalesPending(null);
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
            What attendees buy, such as an Early Bird or Standard pass. Set
            quantity and sales dates here; audience prices live in{" "}
            <Link
              href={pricingHref}
              className="text-primary underline-offset-4 hover:underline"
            >
              Pricing
            </Link>
            .
          </p>
        </div>
        {/* M9-T1: split button — primary launches the guided wizard
            (ticket + audience + price in one save); the chevron menu keeps
            the old, unpriced-only create flow reachable as a secondary,
            clearly-labeled option. */}
        <div className="flex">
          <Button onClick={openWizard} className="rounded-r-none">
            <Plus aria-hidden="true" />
            Create ticket
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="default"
                className="rounded-l-none border-l border-primary-foreground/20 px-2"
                aria-label="More create ticket options"
              >
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={openCreateTicketOnly}>
                Create ticket type only (no pricing yet)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {salesError ? (
        <p role="alert" className="text-sm text-destructive">
          {salesError}
        </p>
      ) : null}

      {loadError ? (
        <EntityTableError entityLabel="ticket types" onRetry={refresh} />
      ) : tickets.length === 0 ? (
        <EntityEmptyState
          icon={Ticket}
          title="No ticket types yet"
          description="Create admission items like early bird, standard, and comp tickets, and price them for each audience — all in one guided flow."
          actionLabel="+ Create ticket"
          onAction={openWizard}
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
                  <TableHead>Ticket quantity</TableHead>
                  <TableHead>Sales window</TableHead>
                  <TableHead>Sales status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTickets.map((sourceTicket) => {
                  const ticket = {
                    ...sourceTicket,
                    isOpen:
                      salesOverrides[sourceTicket.id] ?? sourceTicket.isOpen,
                  };
                  const eligibleFees = fees.filter(
                    (fee) =>
                      fee.registrationTypeId === null ||
                      ticket.registrationTypeIds.length === 0 ||
                      ticket.registrationTypeIds.includes(
                        fee.registrationTypeId,
                      ),
                  );
                  const priceDisplay = getTicketPriceDisplay(
                    ticket.id,
                    eligibleFees,
                  );
                  const salesStatus = getSalesStatus(
                    ticket,
                    nowMs,
                    priceDisplay !== null,
                  );
                  const open = salesStatus === "On sale";
                  return (
                    <TableRow key={ticket.id}>
                      <TableCell className="font-medium text-foreground">
                        {ticket.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {ticket.code}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {/* Fee-derived price (M2-T1 AC-12): the price lives on
                            Fee rows, never on the ticket itself. */}
                        {priceDisplay ? (
                          <span title={priceDisplay.title}>
                            {priceDisplay.label}
                            {priceDisplay.extra ? (
                              <span className="ml-1 text-xs text-muted-foreground">
                                {priceDisplay.extra}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <Link
                            href={pricingHref}
                            title="Set a price in Pricing"
                            aria-label="Set a price in Pricing"
                            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                          >
                            —
                          </Link>
                        )}
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
                            {salesStatus}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="rounded-full">
                            {salesStatus}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={salesPending !== null}
                            aria-label={`${ticket.isOpen ? "Pause" : "Resume"} sales for ${ticket.name}`}
                            onClick={() => toggleSales(ticket)}
                          >
                            {salesPending === ticket.id ? (
                              <Loader2
                                aria-hidden="true"
                                className="animate-spin"
                              />
                            ) : ticket.isOpen ? (
                              <Pause aria-hidden="true" />
                            ) : (
                              <Play aria-hidden="true" />
                            )}
                            {salesPending === ticket.id
                              ? "Updating…"
                              : ticket.isOpen
                                ? "Pause sales"
                                : "Resume sales"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground"
                            disabled={salesPending !== null}
                            aria-label={`Edit ${ticket.name}`}
                            onClick={() => openEdit(ticket)}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={salesPending !== null}
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

      <CreateTicketWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        eventId={eventId}
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
