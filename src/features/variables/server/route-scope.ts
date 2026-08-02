import "server-only";

import { cookies } from "next/headers";

import decodeUser from "@/lib/auth-utils";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { resolveActiveOrganizationId } from "@/lib/org-membership";
import type { EventDoc, WithId } from "@/types/collection";

const COOKIE_NAME = "session";

export type VariablesOrganizationRouteScope =
  | { ok: true; organizationId: string }
  | { ok: false; error: string; status: 401 | 403 };

export type VariablesEventRouteScope =
  | { ok: true; organizationId: string; event: WithId<EventDoc> }
  | { ok: false; error: string; status: 401 | 403 | 404 };

export async function resolveVariablesOrganizationRouteScope(
  options: { requireWriteEvents?: boolean } = {},
): Promise<VariablesOrganizationRouteScope> {
  const requireWriteEvents = options.requireWriteEvents ?? true;
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

  if (requireWriteEvents && !userDoc?.permissions.includes("write:events")) {
    return {
      ok: false,
      error: "Missing write:events permission",
      status: 403,
    };
  }

  return { ok: true, organizationId };
}

export async function resolveVariablesEventRouteScope(
  eventId: string,
  options: { requireWriteEvents?: boolean } = {},
): Promise<VariablesEventRouteScope> {
  const organizationScope = await resolveVariablesOrganizationRouteScope(options);
  if (!organizationScope.ok) {
    return organizationScope;
  }

  const event = await getAdminEventForOrganization(
    eventId,
    organizationScope.organizationId,
  );
  if (!event) {
    return { ok: false, error: "Event not found", status: 404 };
  }

  return {
    ok: true,
    organizationId: organizationScope.organizationId,
    event,
  };
}
