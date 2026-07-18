"use client";

// Role-change confirmation (design §3/§4). Two visual weights: a lightweight
// Dialog for an Editor<->Viewer change, escalating to a genuine AlertDialog
// confirm for anything touching the Owner/Admin tier (D10/isOwnerTierRoleChange).
// Only ONE of the two overlays is ever open at a time (open is split by
// `step`), avoiding the "two independently-triggered overlays fighting for
// focus" pitfall the design's accessibility notes flag.
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  assignableRoles,
  isOwnerTierRoleChange,
  roleLabel,
  roleRank,
} from "@/features/iam/permissions";
import type { MemberRow, OrgRole } from "@/features/iam/types";

const LAST_OWNER_MESSAGE =
  "This organization must have at least one Owner. Promote another member to Owner first, then try this change again.";

function alertCopy(
  currentRole: OrgRole,
  newRole: OrgRole,
  name: string,
): { title: string; description: string } {
  if (newRole === "owner") {
    return {
      title: `Make ${name} an Owner?`,
      description: `${name} will have full control of this workspace, including managing other Owners and Admins.`,
    };
  }
  if (currentRole === "owner") {
    return {
      title: `Remove Owner access from ${name}?`,
      description: `${name} will lose Owner-level control, including the ability to manage other Owners and Admins.`,
    };
  }
  if (newRole === "admin") {
    return {
      title: `Make ${name} an Admin?`,
      description: `${name} will be able to manage Editors and Viewers, and will gain full workspace access — but won't be able to manage Owners or other Admins.`,
    };
  }
  return {
    title: `Remove Admin access from ${name}?`,
    description: `${name} will lose Admin-level access and the ability to manage other members.`,
  };
}

interface RoleChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberRow | null;
  callerRole: OrgRole;
  onChanged: (email: string, newRole: OrgRole) => void;
}

export function RoleChangeDialog({
  open,
  onOpenChange,
  member,
  callerRole,
  onChanged,
}: RoleChangeDialogProps) {
  const [step, setStep] = useState<"select" | "confirm">("select");
  const [selectedRole, setSelectedRole] = useState<OrgRole>("viewer");
  const [pending, setPending] = useState(false);
  const [guardrailError, setGuardrailError] = useState<string | null>(null);

  useEffect(() => {
    if (open && member) {
      setStep("select");
      setSelectedRole(member.role);
      setPending(false);
      setGuardrailError(null);
    }
  }, [open, member]);

  if (!member) return null;

  const options = assignableRoles(callerRole);
  const ownerTier = isOwnerTierRoleChange(member.role, selectedRole);
  const noChange = selectedRole === member.role;
  const name = member.name || member.email;
  const promoting = roleRank(selectedRole) > roleRank(member.role);
  const copy = alertCopy(member.role, selectedRole, name);

  const submit = async () => {
    setPending(true);
    setGuardrailError(null);
    try {
      const response = await fetch(
        `/api/dashboard/iam/members/${encodeURIComponent(member.email)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: selectedRole }),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        if (data?.code === "last-owner") {
          setGuardrailError(data.error ?? LAST_OWNER_MESSAGE);
          return;
        }
        if (response.status === 403) {
          toast.error("You don't have permission to do that.");
          onOpenChange(false);
          return;
        }
        toast.error("Failed to update the role.", {
          description: "Check your connection and try again.",
        });
        onOpenChange(false);
        return;
      }

      onChanged(member.email, selectedRole);
      toast.success(`${name}'s role updated to ${roleLabel(selectedRole)}`);
      onOpenChange(false);
    } catch {
      toast.error("Failed to update the role.", {
        description: "Check your connection and try again.",
      });
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Dialog
        open={open && step === "select"}
        onOpenChange={(next) => {
          if (!next) onOpenChange(false);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change {name}&apos;s role</DialogTitle>
            <DialogDescription>
              {name} is currently {roleLabel(member.role)}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="role-change-select">New role</Label>
            <Select
              value={selectedRole}
              onValueChange={(value) => setSelectedRole(value as OrgRole)}
            >
              <SelectTrigger id="role-change-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((role) => (
                  <SelectItem key={role} value={role}>
                    {roleLabel(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            {ownerTier ? (
              <Button
                type="button"
                disabled={noChange}
                onClick={() => setStep("confirm")}
              >
                Continue
              </Button>
            ) : (
              <Button
                type="button"
                disabled={noChange || pending}
                onClick={() => void submit()}
              >
                {pending ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                Save
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={open && step === "confirm"}
        onOpenChange={(next) => {
          if (!next) onOpenChange(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.description}
              {member.isSelf ? (
                <span className="mt-2 block">
                  You are changing your own role. This won&apos;t affect your
                  current session until your next action.
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {guardrailError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              {guardrailError}
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            {promoting ? (
              <Button
                type="button"
                disabled={pending || guardrailError !== null}
                onClick={() => void submit()}
              >
                {pending ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                Make {roleLabel(selectedRole)}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="text-amber-700 dark:text-amber-400"
                disabled={pending || guardrailError !== null}
                onClick={() => void submit()}
              >
                {pending ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                Remove {roleLabel(member.role)} access
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
