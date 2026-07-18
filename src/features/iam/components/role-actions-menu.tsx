"use client";

// Per-row Actions menu (design §1). Rendered only when the caller has
// canManageMembers (write:user). D10's hierarchy is mirrored here as a
// client-side UX affordance (the server route independently re-checks it):
// a caller who CANNOT act on this row's current role sees an em dash, not a
// disabled menu — "not applicable to you," not "a setting you could change
// with more permission."
import { MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canManageTargetRole } from "@/features/iam/permissions";
import type { OrgRole } from "@/features/iam/types";

interface RoleActionsMenuProps {
  name: string;
  role: OrgRole;
  callerRole: OrgRole;
  kind: "member" | "invitation";
  onChangeRole?: () => void;
  onRemove?: () => void;
  onRevoke?: () => void;
}

export function RoleActionsMenu({
  name,
  role,
  callerRole,
  kind,
  onChangeRole,
  onRemove,
  onRevoke,
}: RoleActionsMenuProps) {
  if (!canManageTargetRole(callerRole, role)) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${name}`}>
          <MoreVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {kind === "member" ? (
          <>
            <DropdownMenuItem onSelect={() => onChangeRole?.()}>
              Change role
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onRemove?.()}
            >
              Remove
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem variant="destructive" onSelect={() => onRevoke?.()}>
            Revoke invitation
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
