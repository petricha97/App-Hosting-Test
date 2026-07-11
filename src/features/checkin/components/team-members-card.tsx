"use client";

// Team members (door scanners) card (M5-T4 AC-4/AC-6/AC-7, design §3):
// active-member list with per-row Revoke (AlertDialog confirm — revoking
// immediately 401s the device's outstanding scanner sessions), the dashed
// empty-state panel, and the two-phase add dialog.

import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AddTeamMemberDialog } from "@/features/checkin/components/add-team-member-dialog";
import type { SerializedTeamMember } from "@/features/checkin/utils";

interface TeamMembersCardProps {
  eventId: string;
  initialMembers: SerializedTeamMember[];
}

function lastSeenLabel(iso: string | null): string {
  if (!iso) return "Never used";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "Never used";
  return `Last seen ${new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;
}

export function TeamMembersCard({
  eventId,
  initialMembers,
}: TeamMembersCardProps) {
  const [members, setMembers] = useState(initialMembers);
  const [addOpen, setAddOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SerializedTeamMember | null>(
    null,
  );
  const [revoking, setRevoking] = useState(false);

  const revoke = async (member: SerializedTeamMember) => {
    setRevoking(true);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/checkin/team-members/${encodeURIComponent(member.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        toast.error("Couldn't revoke access. Try again.");
        return;
      }
      setMembers((current) => current.filter((m) => m.id !== member.id));
      toast.success(`Access revoked for ${member.name}`);
      setRevokeTarget(null);
    } catch {
      toast.error("Couldn't revoke access. Check your connection.");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team members (door scanners)</CardTitle>
        <CardAction>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            Add team member
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-6">
        {members.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No team members yet — add staff devices to scan at the door.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{member.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[member.deviceLabel, lastSeenLabel(member.lastSeenAtIso)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRevokeTarget(member)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke access?</AlertDialogTitle>
            <AlertDialogDescription>
              This device can no longer scan. Any active scanner session for
              {revokeTarget ? ` ${revokeTarget.name}` : " this member"} stops
              working immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoking}
              onClick={(event) => {
                event.preventDefault();
                if (revokeTarget) void revoke(revokeTarget);
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddTeamMemberDialog
        eventId={eventId}
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(member) => setMembers((current) => [member, ...current])}
      />
    </Card>
  );
}
