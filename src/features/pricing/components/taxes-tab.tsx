"use client";

// Taxes tab (M2-T3): CTA + count badge, table with the 5 spec columns
// (Name | Code | Type | Rate | Active), inline Active toggle (AC-3),
// create/edit dialog, and delete confirm with the order-reference BLOCK.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Percent, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TaxDialog } from "@/features/pricing/components/tax-dialog";
import type { SerializedTax } from "@/features/pricing/types";
import { formatTaxRate } from "@/features/pricing/utils";
import { DeleteEntityDialog } from "@/features/registration/components/delete-entity-dialog";
import {
  EntityEmptyState,
  EntityTableError,
} from "@/features/registration/components/entity-table-states";
import { InfoNote } from "@/features/registration/components/info-note";

interface TaxesTabProps {
  eventId: string;
  taxes: SerializedTax[];
  loadError: boolean;
}

export function TaxesTab({ eventId, taxes, loadError }: TaxesTabProps) {
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SerializedTax | null>(null);
  const [deleting, setDeleting] = useState<SerializedTax | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const refresh = () => router.refresh();

  const taxItemUrl = (taxId: string) =>
    `/api/dashboard/events/${encodeURIComponent(eventId)}/pricing/taxes/${encodeURIComponent(taxId)}`;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (tax: SerializedTax) => {
    setEditing(tax);
    setDialogOpen(true);
  };

  // Inline Active toggle (spec AC-3) — lightweight { isActive } PATCH.
  const toggleActive = async (tax: SerializedTax) => {
    setTogglingId(tax.id);
    try {
      const response = await fetch(taxItemUrl(tax.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !tax.isActive }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        toast.error(
          typeof data?.error === "string"
            ? data.error
            : "Failed to update the tax.",
        );
        return;
      }

      toast.success(!tax.isActive ? "Tax activated" : "Tax deactivated");
      refresh();
    } catch {
      toast.error("Failed to update the tax.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setTogglingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;

    setDeletePending(true);
    try {
      const response = await fetch(taxItemUrl(deleting.id), {
        method: "DELETE",
      });

      if (response.ok) {
        toast.success("Tax deleted");
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
        typeof data?.error === "string" ? data.error : "Failed to delete the tax.",
      );
    } catch {
      toast.error("Failed to delete the tax.", {
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
            {taxes.length} {taxes.length === 1 ? "tax" : "taxes"}
          </Badge>
        </span>
        <Button onClick={openCreate}>
          <Plus aria-hidden="true" />
          Create tax
        </Button>
      </div>

      <InfoNote>
        Every <b>active</b> tax applies to each order&apos;s post-discount
        amount. Each tax line rounds independently (half-up), then lines are
        summed — fixed-amount taxes apply only to orders in their currency.
      </InfoNote>

      {loadError ? (
        <EntityTableError entityLabel="taxes" onRetry={refresh} />
      ) : taxes.length === 0 ? (
        <EntityEmptyState
          icon={Percent}
          title="No taxes configured"
          description="Add VAT or sales tax to apply on top of fees at checkout."
          actionLabel="+ Create tax"
          onAction={openCreate}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table aria-label="Taxes" className="min-w-[40rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-40">Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taxes.map((tax) => (
                  <TableRow key={tax.id}>
                    <TableCell className="font-medium text-foreground">
                      {tax.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {tax.code}
                    </TableCell>
                    <TableCell>
                      {tax.type === "percentage" ? "Percentage" : "Fixed"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTaxRate(tax)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={tax.isActive}
                          disabled={togglingId === tax.id}
                          onCheckedChange={() => toggleActive(tax)}
                          aria-label={`Toggle ${tax.name} active`}
                        />
                        {tax.isActive ? (
                          <Badge className="rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                            Yes
                          </Badge>
                        ) : (
                          <Badge className="rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                            No
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Edit ${tax.name}`}
                          onClick={() => openEdit(tax)}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Delete ${tax.name}`}
                          onClick={() => {
                            setDeleteBlocked(null);
                            setDeleting(tax);
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <TaxDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        tax={editing}
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
        title={`Delete ${deleting?.name ?? "tax"}?`}
        description="This permanently removes the tax. It stops applying to new orders immediately."
        blockedMessage={deleteBlocked}
        pending={deletePending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
