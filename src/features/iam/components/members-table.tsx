"use client";

// Members & invitations table (design §1) — one combined table adapting
// users.html's 4-column structure (Member | Email | Role | Status), with a
// 5th Actions column added only for callers who canManageMembers.
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RoleActionsMenu } from "@/features/iam/components/role-actions-menu";
import { RoleBadge } from "@/features/iam/components/role-badge";
import { StatusBadge } from "@/features/iam/components/status-badge";
import type {
  IamRosterRow,
  InvitationRow,
  MemberRow,
  OrgRole,
} from "@/features/iam/types";

const ROLE_ORDER: OrgRole[] = ["owner", "admin", "editor", "viewer"];

function displayName(row: IamRosterRow): string {
  if (row.kind === "member" && row.name.trim().length > 0) {
    return row.name;
  }
  const localPart = row.email.split("@")[0] ?? row.email;
  return localPart.length === 0
    ? row.email
    : localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

function sortRows(
  members: MemberRow[],
  invitations: InvitationRow[],
): IamRosterRow[] {
  const rows: IamRosterRow[] = [
    ...members.map((member) => ({ kind: "member" as const, ...member })),
    ...invitations.map((invitation) => ({
      kind: "invitation" as const,
      ...invitation,
    })),
  ];

  return rows.sort((a, b) => {
    const roleDiff = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    if (roleDiff !== 0) return roleDiff;
    if (a.kind !== b.kind) return a.kind === "member" ? -1 : 1;
    return displayName(a).localeCompare(displayName(b));
  });
}

interface MembersTableProps {
  members: MemberRow[];
  invitations: InvitationRow[];
  canManageMembers: boolean;
  callerRole: OrgRole;
  onChangeRole: (member: MemberRow) => void;
  onRemove: (member: MemberRow) => void;
  onRevoke: (invitation: InvitationRow) => void;
}

export function MembersTable({
  members,
  invitations,
  canManageMembers,
  callerRole,
  onChangeRole,
  onRemove,
  onRevoke,
}: MembersTableProps) {
  const rows = sortRows(members, invitations);
  const columnCount = canManageMembers ? 5 : 4;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <Table className={canManageMembers ? "min-w-[40rem]" : "min-w-[32rem]"}>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              {canManageMembers ? (
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const name = displayName(row);
              return (
                <TableRow key={`${row.kind}-${row.email}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>
                          {name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-foreground">
                        {name}
                        {row.kind === "member" && row.isSelf ? (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            (you)
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {row.email}
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={row.role} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={row.kind === "member" ? "active" : "invited"}
                    />
                  </TableCell>
                  {canManageMembers ? (
                    <TableCell className="text-right">
                      <RoleActionsMenu
                        name={name}
                        role={row.role}
                        callerRole={callerRole}
                        kind={row.kind}
                        onChangeRole={
                          row.kind === "member"
                            ? () => onChangeRole(row)
                            : undefined
                        }
                        onRemove={
                          row.kind === "member"
                            ? () => onRemove(row)
                            : undefined
                        }
                        onRevoke={
                          row.kind === "invitation"
                            ? () => onRevoke(row)
                            : undefined
                        }
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
            {invitations.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columnCount}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No pending invitations
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
