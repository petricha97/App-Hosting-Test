import type { ReactNode } from "react";

import { requireSessionUser } from "@/lib/session";
import { DashboardShell } from "@/features/dashboard/components/dashboard-shell";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // Memoized per request — the parent dashboard layout already verified the
  // token, so this only re-reads the cached result to get the user profile.
  const user = await requireSessionUser();

  return (
    <DashboardShell
      serverUser={{
        name: user.name,
        email: user.email,
        picture: user.picture,
      }}
    >
      {children}
    </DashboardShell>
  );
}
