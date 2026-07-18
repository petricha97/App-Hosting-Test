"use client";

// Users & Access screen (M8-T1, design §0) — rebuilt in place: the
// "Permission groups" card and all mock data (permissionGroups/pendingInvites/
// memberSummaries) are removed (spec D1). Real data via GET /api/dashboard/iam
// on mount; mutations locally patch the same in-memory state, matching
// report-schedules-dialog.tsx's setSchedules((current) => ...) idiom — no
// full re-fetch after every mutation.
import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DeleteEntityDialog } from "@/features/registration/components/delete-entity-dialog";
import { EntityTableError } from "@/features/registration/components/entity-table-states";
import { InviteMemberDialog } from "@/features/iam/components/invite-member-dialog";
import { MembersTable } from "@/features/iam/components/members-table";
import { RoleChangeDialog } from "@/features/iam/components/role-change-dialog";
import { RoleDescriptionCards } from "@/features/iam/components/role-description-cards";
import type {
  IamDashboardData,
  InvitationRow,
  MemberRow,
  OrgRole,
} from "@/features/iam/types";

const LAST_OWNER_REMOVE_MESSAGE =
  "This organization must have at least one Owner. Promote another member to Owner before removing this one.";

function IamScreenSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4">
              <Skeleton className="h-5 w-1/3 min-w-32" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-12" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export function IamDashboard() {
  const [data, setData] = useState<IamDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleChangeOpen, setRoleChangeOpen] = useState(false);
  const [roleChangeTarget, setRoleChangeTarget] = useState<MemberRow | null>(
    null,
  );
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [removeBlockedMessage, setRemoveBlockedMessage] = useState<
    string | null
  >(null);
  const [removePending, setRemovePending] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<InvitationRow | null>(null);
  const [revokePending, setRevokePending] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/dashboard/iam");
      if (!response.ok) {
        setError(true);
        return;
      }
      const payload = (await response.json()) as IamDashboardData;
      setData(payload);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  if (loading) {
    return <IamScreenSkeleton />;
  }

  const canManageMembers = data?.canManageMembers ?? false;
  const callerRole: OrgRole = data?.currentUserRole ?? "viewer";

  const handleInvited = (invitation: InvitationRow) => {
    setData((current) =>
      current
        ? {
            ...current,
            invitations: [
              ...current.invitations.filter(
                (existing) => existing.email !== invitation.email,
              ),
              invitation,
            ],
          }
        : current,
    );
  };

  const handleRoleChanged = (email: string, newRole: OrgRole) => {
    setData((current) =>
      current
        ? {
            ...current,
            members: current.members.map((member) =>
              member.email === email ? { ...member, role: newRole } : member,
            ),
          }
        : current,
    );
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setRemovePending(true);
    try {
      const response = await fetch(
        `/api/dashboard/iam/members/${encodeURIComponent(removeTarget.email)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        if (body?.code === "last-owner") {
          setRemoveBlockedMessage(body.error ?? LAST_OWNER_REMOVE_MESSAGE);
          return;
        }
        if (response.status === 403) {
          toast.error("You don't have permission to do that.");
        } else {
          toast.error("Failed to remove the member.", {
            description: "Check your connection and try again.",
          });
        }
        setRemoveTarget(null);
        return;
      }
      setData((current) =>
        current
          ? {
              ...current,
              members: current.members.filter(
                (member) => member.email !== removeTarget.email,
              ),
            }
          : current,
      );
      toast.success(
        `${removeTarget.name || removeTarget.email} removed from the workspace`,
      );
      setRemoveTarget(null);
    } catch {
      toast.error("Failed to remove the member.", {
        description: "Check your connection and try again.",
      });
      setRemoveTarget(null);
    } finally {
      setRemovePending(false);
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    setRevokePending(true);
    try {
      const response = await fetch(
        `/api/dashboard/iam/invites/${encodeURIComponent(revokeTarget.email)}/revoke`,
        { method: "POST" },
      );
      if (!response.ok) {
        if (response.status === 403) {
          toast.error("You don't have permission to do that.");
        } else {
          toast.error("Failed to revoke the invitation.", {
            description: "Check your connection and try again.",
          });
        }
        setRevokeTarget(null);
        return;
      }
      setData((current) =>
        current
          ? {
              ...current,
              invitations: current.invitations.filter(
                (invitation) => invitation.email !== revokeTarget.email,
              ),
            }
          : current,
      );
      toast.success("Invitation revoked");
      setRevokeTarget(null);
    } catch {
      toast.error("Failed to revoke the invitation.", {
        description: "Check your connection and try again.",
      });
      setRevokeTarget(null);
    } finally {
      setRevokePending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Users &amp; Access
          </h1>
          <p className="text-sm text-muted-foreground">
            Workspace members and their roles. Roles map to what each person can
            edit.
          </p>
        </div>
        {canManageMembers ? (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus aria-hidden="true" />
            Invite member
          </Button>
        ) : null}
      </div>

      {error || !data ? (
        <EntityTableError
          entityLabel="members and invitations"
          onRetry={() => void fetchData()}
        />
      ) : (
        <MembersTable
          members={data.members}
          invitations={data.invitations}
          canManageMembers={canManageMembers}
          callerRole={callerRole}
          onChangeRole={(member) => {
            setRoleChangeTarget(member);
            setRoleChangeOpen(true);
          }}
          onRemove={(member) => {
            setRemoveTarget(member);
            setRemoveBlockedMessage(null);
          }}
          onRevoke={(invitation) => setRevokeTarget(invitation)}
        />
      )}

      <RoleDescriptionCards />

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        callerRole={callerRole}
        onInvited={handleInvited}
      />

      <RoleChangeDialog
        open={roleChangeOpen}
        onOpenChange={setRoleChangeOpen}
        member={roleChangeTarget}
        callerRole={callerRole}
        onChanged={handleRoleChanged}
      />

      <DeleteEntityDialog
        open={removeTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRemoveTarget(null);
            setRemoveBlockedMessage(null);
          }
        }}
        title={`Remove ${removeTarget?.name || removeTarget?.email || ""}?`}
        description="They will immediately lose access to this workspace."
        blockedMessage={removeBlockedMessage}
        pending={removePending}
        onConfirm={() => void confirmRemove()}
      />

      <DeleteEntityDialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRevokeTarget(null);
        }}
        title={`Revoke invite to ${revokeTarget?.email ?? ""}?`}
        description="They won't be able to use this link to join anymore."
        blockedMessage={null}
        pending={revokePending}
        onConfirm={() => void confirmRevoke()}
        confirmLabel="Revoke"
      />
    </div>
  );
}
