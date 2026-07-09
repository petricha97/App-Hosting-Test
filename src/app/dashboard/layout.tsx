import type { ReactNode } from "react";

import { requireSessionUser } from "@/lib/session";

// Auth/session gate only — chrome is mounted by the route-group layouts:
// (workspace) renders DashboardShell, (event) renders EventShell.
// requireSessionUser is memoized per request (React cache), so the nested
// route-group layouts and getDashboardScope re-use this verification.
export default async function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  await requireSessionUser();

  return <>{children}</>;
}
