"use client";

// Shared delete-confirm dialog for registration types and ticket types.
// Two modes:
// - Confirm: Cancel + destructive Delete (stays open while the request runs).
// - Blocked (spec BLOCK rule — referenced by tickets or registeredCount > 0):
//   the body shows the server's 409 message and the only action is Close.
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface DeleteEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  // When set, deletion is blocked: the message replaces the description and
  // no destructive action is offered.
  blockedMessage: string | null;
  pending: boolean;
  onConfirm: () => void;
  // M8-T1 (design §4/§5): the invitation-revoke reuse of this dialog wants
  // "Revoke" instead of "Delete" on the destructive action. Optional and
  // additive — every pre-existing caller is unaffected by the "Delete" default.
  confirmLabel?: string;
}

export function DeleteEntityDialog({
  open,
  onOpenChange,
  title,
  description,
  blockedMessage,
  pending,
  onConfirm,
  confirmLabel = "Delete",
}: DeleteEntityDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {blockedMessage ?? description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {blockedMessage ? (
            <AlertDialogCancel disabled={pending}>Close</AlertDialogCancel>
          ) : (
            <>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={onConfirm}
              >
                {pending ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                {confirmLabel}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
