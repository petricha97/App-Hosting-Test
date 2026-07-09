import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { requireSessionUser } from "@/lib/session";
import { getAdminOrganizationById } from "@/lib/db/adminOrganization";
import { getAdminUserByEmail } from "@/lib/db/adminUser";

// Memoized per request: layouts and pages both call this, so cache() avoids
// repeating the user/org Firestore lookups. Token verification and the
// disabled-user/login policy live in requireSessionUser (itself memoized).
export const getDashboardScope = cache(async () => {
  const decodedUser = await requireSessionUser();

  const userDoc = await getAdminUserByEmail(decodedUser.email.toLowerCase());

  if (!userDoc?.organizationId) {
    redirect("/login");
  }

  const organization = await getAdminOrganizationById(userDoc.organizationId);

  return {
    authUser: decodedUser,
    userDoc,
    organization,
    organizationId: userDoc.organizationId,
  };
});
