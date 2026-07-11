"use client";

// Abandoned-registrations table (M5-T3, design §2): Name | Email (domain
// only) | Last page reached | Date | delete action. The email column never
// carries a local part — masking happened server-side. Per-row delete
// confirms via AlertDialog and reuses the M3 purge route.

import { Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import {
  ABANDONED_EMPTY_FALLBACK,
  DRAFT_STEP_LABELS,
  isLateDraftStep,
  type SerializedAbandonedDraft,
} from "@/features/attendees/abandoned";
import { cn } from "@/lib/utils";

function formatDate(iso: string | null): string {
  if (!iso) return ABANDONED_EMPTY_FALLBACK;
  return new Intl.DateTimeFormat("en-SG", { dateStyle: "medium" }).format(
    new Date(iso),
  );
}

interface AbandonedTableProps {
  drafts: SerializedAbandonedDraft[];
  deletingId: string | null;
  onDelete: (draft: SerializedAbandonedDraft) => void;
}

export function AbandonedTable({
  drafts,
  deletingId,
  onDelete,
}: AbandonedTableProps) {
  return (
    <div className="overflow-x-auto">
      <Table aria-label="Abandoned registrations" className="min-w-[44rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-40">Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Last page reached</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {drafts.map((draft) => {
            const deleteLabel = `Delete draft from ${
              draft.name !== ABANDONED_EMPTY_FALLBACK
                ? draft.name
                : draft.maskedEmail
            }`;

            return (
              <TableRow key={draft.id}>
                <TableCell className="font-medium text-foreground">
                  {draft.name}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {draft.maskedEmail}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      isLateDraftStep(draft.lastStepReached)
                        ? undefined
                        : "secondary"
                    }
                    className={cn(
                      "rounded-full",
                      isLateDraftStep(draft.lastStepReached) &&
                        "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
                    )}
                  >
                    {DRAFT_STEP_LABELS[draft.lastStepReached]}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(draft.updatedAtIso)}
                </TableCell>
                <TableCell className="text-right">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={deleteLabel}
                        disabled={deletingId === draft.id}
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Delete abandoned registration?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the draft. The visitor can
                          always start again.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-white hover:bg-destructive/90"
                          onClick={() => onDelete(draft)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
