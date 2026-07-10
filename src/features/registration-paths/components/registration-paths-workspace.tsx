"use client";

// Registration Paths screen (M3-T1): header + CTA, note banner, example
// flow-diagram card (first active path), table with inline Active toggle and
// up/down reorder, create/edit dialog, and BLOCK-style delete confirm.
// Data arrives from the server page; every mutation calls router.refresh().
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
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
import { FlowDiagramCard } from "@/features/registration-paths/components/flow-diagram-card";
import { PathDialog } from "@/features/registration-paths/components/path-dialog";
import type { SerializedRegistrationPath } from "@/features/registration-paths/types";
import { PAYMENT_METHOD_LABELS } from "@/features/registration-paths/utils";
import { DeleteEntityDialog } from "@/features/registration/components/delete-entity-dialog";
import {
  EntityEmptyState,
  EntityTableError,
} from "@/features/registration/components/entity-table-states";
import { InfoNote } from "@/features/registration/components/info-note";
import type { SerializedRegistrationType } from "@/features/registration/types";

interface RegistrationPathsWorkspaceProps {
  eventId: string;
  paths: SerializedRegistrationPath[];
  registrationTypes: SerializedRegistrationType[];
  loadError: boolean;
}

export function RegistrationPathsWorkspace({
  eventId,
  paths,
  registrationTypes,
  loadError,
}: RegistrationPathsWorkspaceProps) {
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SerializedRegistrationPath | null>(
    null,
  );
  const [deleting, setDeleting] = useState<SerializedRegistrationPath | null>(
    null,
  );
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  // Optimistic Active values (design §1): the Switch flips immediately and
  // rolls back with a toast when the PATCH fails.
  const [activeOverrides, setActiveOverrides] = useState<
    Record<string, boolean>
  >({});
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [reorderPending, setReorderPending] = useState(false);

  const refresh = () => router.refresh();

  const registrationTypeNamesById = new Map(
    registrationTypes.map((registrationType) => [
      registrationType.id,
      registrationType.name,
    ]),
  );

  const pathItemUrl = (pathId: string) =>
    `/api/dashboard/events/${encodeURIComponent(eventId)}/registration-paths/${encodeURIComponent(pathId)}`;

  const nextSortOrder =
    paths.length === 0 ? 0 : paths[paths.length - 1].sortOrder + 1;

  const firstActivePath = paths.find((path) => path.isActive) ?? null;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (path: SerializedRegistrationPath) => {
    setEditing(path);
    setDialogOpen(true);
  };

  // Inline Active toggle (T1 AC-4) — optimistic { isActive } PATCH with
  // rollback on failure.
  const toggleActive = async (path: SerializedRegistrationPath) => {
    const nextActive = !(activeOverrides[path.id] ?? path.isActive);
    setTogglingId(path.id);
    setActiveOverrides((current) => ({ ...current, [path.id]: nextActive }));

    const rollback = () =>
      setActiveOverrides((current) => {
        const next = { ...current };
        delete next[path.id];
        return next;
      });

    try {
      const response = await fetch(pathItemUrl(path.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        rollback();
        toast.error(
          typeof data?.error === "string"
            ? data.error
            : "Failed to update the registration path.",
        );
        return;
      }

      toast.success(nextActive ? "Path activated" : "Path deactivated");
      refresh();
    } catch {
      rollback();
      toast.error("Failed to update the registration path.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setTogglingId(null);
    }
  };

  // Up/down reorder (T1 AC-10): swap sortOrder with the adjacent row via two
  // lightweight { sortOrder } PATCHes, then refresh so table + public picker
  // re-sort from the server.
  const movePath = async (index: number, direction: -1 | 1) => {
    const path = paths[index];
    const neighbor = paths[index + direction];
    if (!path || !neighbor) return;

    setReorderPending(true);
    try {
      const responses = await Promise.all([
        fetch(pathItemUrl(path.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: neighbor.sortOrder }),
        }),
        fetch(pathItemUrl(neighbor.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: path.sortOrder }),
        }),
      ]);

      if (responses.some((response) => !response.ok)) {
        toast.error("Failed to reorder the registration paths.");
      }
      refresh();
    } catch {
      toast.error("Failed to reorder the registration paths.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setReorderPending(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;

    setDeletePending(true);
    try {
      const response = await fetch(pathItemUrl(deleting.id), {
        method: "DELETE",
      });

      if (response.ok) {
        toast.success("Registration path deleted");
        setDeleting(null);
        refresh();
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      if (response.status === 409 && typeof data?.error === "string") {
        // Blocked by referencing drafts/submissions — swap the dialog into
        // its Close-only mode with the server's "Deactivate instead" message.
        setDeleteBlocked(data.error);
        return;
      }

      toast.error(
        typeof data?.error === "string"
          ? data.error
          : "Failed to delete the registration path.",
      );
    } catch {
      toast.error("Failed to delete the registration path.", {
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
            Registration paths
          </h1>
          <p className="text-sm text-muted-foreground">
            The multi-step flow a registrant goes through. Different audiences
            / payment methods get different paths.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus aria-hidden="true" />
          Create path
        </Button>
      </div>

      <InfoNote>
        A path is the flow a registrant walks through — create one per audience
        × payment method. The same audience paying by card and by invoice = two
        paths. The path also pins the checkout currency.
      </InfoNote>

      {firstActivePath && !loadError ? (
        <FlowDiagramCard path={firstActivePath} />
      ) : null}

      {loadError ? (
        <EntityTableError entityLabel="registration paths" onRetry={refresh} />
      ) : paths.length === 0 ? (
        <EntityEmptyState
          icon={Compass}
          title="No registration paths yet"
          description="A path is the flow a registrant walks through — one per audience × payment method."
          actionLabel="+ Create path"
          onAction={openCreate}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border px-4 py-3">
            <span aria-live="polite">
              <Badge variant="secondary" className="rounded-full tabular-nums">
                {paths.length} {paths.length === 1 ? "path" : "paths"}
              </Badge>
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table aria-label="Registration paths" className="min-w-[52rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-48">Registration path</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paths.map((path, index) => {
                  const isActive = activeOverrides[path.id] ?? path.isActive;

                  return (
                    <TableRow key={path.id}>
                      <TableCell className="font-medium text-foreground">
                        {path.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {path.code}
                      </TableCell>
                      <TableCell>
                        {path.audienceRegistrationTypeId === null ? (
                          <span className="text-muted-foreground">Any</span>
                        ) : (
                          (registrationTypeNamesById.get(
                            path.audienceRegistrationTypeId,
                          ) ?? "Unknown type")
                        )}
                      </TableCell>
                      <TableCell>
                        {PAYMENT_METHOD_LABELS[path.paymentMethod]}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {path.currency}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={isActive}
                            disabled={togglingId === path.id}
                            onCheckedChange={() => toggleActive(path)}
                            aria-label={`Toggle ${path.name} active`}
                          />
                          {isActive ? (
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
                            aria-label={`Move ${path.name} up`}
                            disabled={index === 0 || reorderPending}
                            onClick={() => movePath(index, -1)}
                          >
                            <ChevronUp aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Move ${path.name} down`}
                            disabled={
                              index === paths.length - 1 || reorderPending
                            }
                            onClick={() => movePath(index, 1)}
                          >
                            <ChevronDown aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Edit ${path.name}`}
                            onClick={() => openEdit(path)}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${path.name}`}
                            onClick={() => {
                              setDeleteBlocked(null);
                              setDeleting(path);
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

      <PathDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        path={editing}
        registrationTypes={registrationTypes}
        nextSortOrder={nextSortOrder}
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
        title={`Delete ${deleting?.name ?? "registration path"}?`}
        description="This removes the path permanently. Registrations already collected keep their data."
        blockedMessage={deleteBlocked}
        pending={deletePending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
