import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";

// Educational note banner shared by the registration screens (M1 design §1).
// Always visible — including empty states — because it explains the concept.
export function InfoNote({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground",
        className,
      )}
    >
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
