// Shared status badge (design §1) — Active (emerald) / Invited (amber), both
// with a leading dot replicating users.html's `.badge.dot` convention. Text
// always carries the meaning too (never color-only, accessibility notes).
import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: "active" | "invited" }) {
  if (status === "invited") {
    return (
      <Badge className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <span
          aria-hidden="true"
          className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current"
        />
        Invited
      </Badge>
    );
  }

  return (
    <Badge className="border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
      <span
        aria-hidden="true"
        className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current"
      />
      Active
    </Badge>
  );
}
