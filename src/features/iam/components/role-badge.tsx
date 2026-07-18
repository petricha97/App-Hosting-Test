// Shared role badge (design §1) — used by members-table.tsx, the invite
// "sent" view, and the role-change dialog. Owner is the one net-new color
// token this ticket introduces (violet, matching users.html's explicit
// `badge violet`); Admin/Editor/Viewer intentionally share the SAME neutral
// `variant="secondary"` styling — D5's point that Admin is permission-
// identical to Owner and a loud badge color would overstate a difference
// that doesn't exist at the permission layer.
import { Badge } from "@/components/ui/badge";
import { roleLabel } from "@/features/iam/permissions";
import type { OrgRole } from "@/features/iam/types";

export function RoleBadge({ role }: { role: OrgRole }) {
  if (role === "owner") {
    return (
      <Badge className="border-transparent bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200">
        Owner
      </Badge>
    );
  }

  return <Badge variant="secondary">{roleLabel(role)}</Badge>;
}
