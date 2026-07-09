"use client";

// Registration Types screen (M1-T1): header + CTA, note banner, table with
// row actions, create/edit dialog, and BLOCK-style delete confirm.
// Data arrives from the server page; every mutation calls router.refresh().
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { RegistrationTypeDialog } from "@/features/registration/components/registration-type-dialog";
import type { SerializedRegistrationType } from "@/features/registration/types";

interface RegistrationTypesWorkspaceProps {
  eventId: string;
  registrationTypes: SerializedRegistrationType[];
  loadError: boolean;
}

export function RegistrationTypesWorkspace({
  eventId,
  registrationTypes,
  loadError,
}: RegistrationTypesWorkspaceProps) {
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SerializedRegistrationType | null>(
    null,
  );
  const [deleting, setDeleting] = useState<SerializedRegistrationType | null>(
    null,
  );
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const refresh = () => router.refresh();

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (registrationType: SerializedRegistrationType) => {
    setEditing(registrationType);
    setDialogOpen(true);
  };

  const openDelete = (registrationType: SerializedRegistrationType) => {
    setDeleting(registrationType);
    // Spec BLOCK rule: types with registrations can never be deleted — no
    // destructive action offered when the count is already known to block.
    setDeleteBlocked(
      registrationType.registeredCount > 0
        ? `${registrationType.registeredCount} ${
            registrationType.registeredCount === 1
              ? "person is"
              : "people are"
          } registered under this type. Registration types with registrations cannot be deleted.`
        : null,
    );
  };

  const confirmDelete = async () => {
    if (!deleting) return;

    setDeletePending(true);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/registration-types/${encodeURIComponent(deleting.id)}`,
        { method: "DELETE" },
      );

      if (response.ok) {
        toast.success("Registration type deleted");
        setDeleting(null);
        refresh();
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      if (response.status === 409 && typeof data?.error === "string") {
        // Blocked by referencing tickets (or registrations) — swap the dialog
        // into its Close-only mode with the server's message naming them.
        setDeleteBlocked(data.error);
        return;
      }

      toast.error(
        typeof data?.error === "string"
          ? data.error
          : "Failed to delete the registration type.",
      );
    } catch {
      // Network failure — toast and keep the confirm dialog open for a retry
      // (repo convention, see event-promotion-manager.tsx).
      toast.error("Failed to delete the registration type.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Registration types
          </h1>
          <p className="text-sm text-muted-foreground">
            Who the attendee is. This is the join key that drives pricing,
            badges, emails and access.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus aria-hidden="true" />
          Create type
        </Button>
      </div>

      <InfoNote>
        <b>Why separate from tickets?</b> A &ldquo;Delegate&rdquo; (type) can
        buy several tickets (super early / early / standard). Emails, badges
        and check-in rules all key off the <b>type</b>, so keep it distinct
        from the ticket.
      </InfoNote>

      {loadError ? (
        <EntityTableError entityLabel="registration types" onRetry={refresh} />
      ) : registrationTypes.length === 0 ? (
        <EntityEmptyState
          icon={Tags}
          title="No registration types yet"
          description="Define who can attend — Delegate, VIP, Press, Crew — before creating tickets and pricing."
          actionLabel="+ Create type"
          onAction={openCreate}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <Table aria-label="Registration types" className="min-w-[36rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-48">Registration type</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registrationTypes.map((registrationType) => (
                <TableRow key={registrationType.id}>
                  <TableCell className="font-medium text-foreground">
                    {registrationType.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {registrationType.code}
                  </TableCell>
                  <TableCell>
                    {registrationType.capacity === null
                      ? "Unlimited"
                      : registrationType.capacity}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {registrationType.registeredCount}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Edit ${registrationType.name}`}
                        onClick={() => openEdit(registrationType)}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${registrationType.name}`}
                        onClick={() => openDelete(registrationType)}
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
      )}

      <RegistrationTypeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        registrationType={editing}
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
        title={`Delete ${deleting?.name ?? "registration type"}?`}
        description="This removes the type permanently."
        blockedMessage={deleteBlocked}
        pending={deletePending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
