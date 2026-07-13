import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { requireSessionUser } from "@/lib/session";
import { getAdminOrganizationById } from "@/lib/db/adminOrganization";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { resolveActiveOrganizationId } from "@/lib/org-membership";

// Memoized per request: layouts and pages both call this, so cache() avoids
// repeating the user/org Firestore lookups. Token verification and the
// disabled-user/login policy live in requireSessionUser (itself memoized).
export const getDashboardScope = cache(async () => {
  const decodedUser = await requireSessionUser();

  const userDoc = await getAdminUserByEmail(decodedUser.email.toLowerCase());

  // SEC M2 Finding 1: the active organizationId is client-writable (org
  // switcher); it is only trusted as the dashboard tenant key when the
  // server-locked organizations[] roster confirms membership. Spoofed or
  // missing scope both bounce to /login rather than rendering another
  // tenant's dashboard.
  const organizationId = resolveActiveOrganizationId(userDoc);
  if (!userDoc || !organizationId) {
    redirect("/login");
  }

  const organization = await getAdminOrganizationById(organizationId);

  return {
    authUser: decodedUser,
    userDoc,
    organization,
    organizationId,
  };
});
