import "server-only";

import { cookies } from "next/headers";

import decodeUser from "@/lib/auth-utils";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { resolveActiveOrganizationId } from "@/lib/org-membership";

const COOKIE_NAME = "session";

export type AssetsRouteScope =
  | {
      ok: true;
      organizationId: string;
      userEmail: string;
      canManage: boolean;
    }
  | { ok: false; error: string; status: 401 | 403 };

export async function resolveAssetsRouteScope(
  options: { requireWriteOrganization?: boolean } = {},
): Promise<AssetsRouteScope> {
  const requireWriteOrganization = options.requireWriteOrganization ?? false;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return { ok: false, error: "Missing session", status: 401 };
  }

  const decodedUser = await decodeUser(token);
  if ("error" in decodedUser) {
    return { ok: false, error: decodedUser.error, status: 401 };
  }

  const userDoc = await getAdminUserByEmail(decodedUser.email.toLowerCase());
  const organizationId = resolveActiveOrganizationId(userDoc);
  if (!organizationId) {
    return { ok: false, error: "Missing organization scope", status: 403 };
  }

  const canManage = Boolean(userDoc?.permissions.includes("write:organization"));
  if (requireWriteOrganization && !canManage) {
    return {
      ok: false,
      error: "Missing write:organization permission",
      status: 403,
    };
  }

  return {
    ok: true,
    organizationId,
    userEmail: decodedUser.email.toLowerCase(),
    canManage,
  };
}
