import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import decodeUser from "@/lib/auth-utils";
import { getAdminOrganizationById } from "@/lib/db/adminOrganization";
import { getAdminUserByEmail } from "@/lib/db/adminUser";

const COOKIE_NAME = "session";

export async function getDashboardScope() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    redirect("/login");
  }

  const decodedUser = await decodeUser(token);

  if ("error" in decodedUser) {
    if (decodedUser.error === "USER_DISABLED") {
      redirect("/disabled");
    }

    redirect("/login");
  }

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
}
