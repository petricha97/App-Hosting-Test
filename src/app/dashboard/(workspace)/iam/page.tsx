// Users & Access page (M8-T1). Server Component: gates on org membership
// via getDashboardScope() (spec §2 — the roster itself is view-tier for any
// signed-in member of the active org; there is no permission-denied PAGE
// state, only granular per-row/per-action gating inside IamDashboard, which
// fetches its own data client-side from GET /api/dashboard/iam). Replaces
// the previous zero-auth-call placeholder — every signed-in user of every
// org saw the identical mock before this ticket.
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { IamDashboard } from "@/features/iam/components/iam-dashboard";

export default async function DashboardIamPage() {
  await getDashboardScope();

  return <IamDashboard />;
}
