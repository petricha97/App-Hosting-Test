// Shared auth + tenancy resolution for the M7-T2 report API routes.
// Mirrors resolveRegistrationRouteScope() (src/features/registration/server/
// route-scope.ts) 1:1 — session cookie -> decoded user -> roster-confirmed
// active org -> (export only) write:events -> org-owned event, 404 on
// cross-org/missing so event existence never leaks across tenants.
//
// Spec D1 (agents/docs/specs/m7-report-templates.md): this is the ticket's
// central permission decision — "Run" (on-screen preview) gates on org
// membership ONLY, same as every other PII-bearing read surface (the M5
// roster, the M7-T1 summary cards); CSV export gates on write:events, the
// exact precedent already shipped for src/app/api/dashboard/events/[eventId]/
// attendees/export/route.ts. `requireWriteEvents` defaults to false so a
// caller must opt IN to the stricter export gate explicitly — Run routes
// never accidentally inherit it.
import "server-only";

import { cookies } from "next/headers";

import decodeUser from "@/lib/auth-utils";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { resolveActiveOrganizationId } from "@/lib/org-membership";
import type { EventDoc, WithId } from "@/types/collection";

const COOKIE_NAME = "session";

export type ReportsRouteScope =
  | {
      ok: true;
      organizationId: string;
      event: WithId<EventDoc>;
      // The User doc id (lowercased email) — additive field for M7-T3's
      // schedule CRUD routes (ReportSchedule.createdBy, rate-limit bucket
      // keys). Mirrors RegistrationRouteScope.userId
      // (src/features/registration/server/route-scope.ts). Pre-M7-T3
      // consumers ignore it.
      userId: string;
    }
  | { ok: false; error: string; status: 401 | 403 | 404 };

export async function resolveReportsRouteScope(
  eventId: string,
  options: { requireWriteEvents?: boolean } = {},
): Promise<ReportsRouteScope> {
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
  // SEC M2 Finding 1 (carried, same as resolveRegistrationRouteScope):
  // userDoc.organizationId is client-writable via the org switcher — only
  // trusted as the tenant key when the server-locked organizations[] roster
  // confirms membership.
  const organizationId = resolveActiveOrganizationId(userDoc);
  if (!organizationId) {
    return { ok: false, error: "Missing organization scope", status: 403 };
  }

  // Export routes only (spec D1) — Run's own list/paginate routes skip this
  // check entirely, matching getDashboardScope()'s org-membership-only shape.
  if (
    options.requireWriteEvents &&
    !userDoc?.permissions.includes("write:events")
  ) {
    return {
      ok: false,
      error: "Missing write:events permission",
      status: 403,
    };
  }

  const event = await getAdminEventForOrganization(eventId, organizationId);
  if (!event) {
    return { ok: false, error: "Event not found", status: 404 };
  }

  return {
    ok: true,
    organizationId,
    event,
    userId: decodedUser.email.toLowerCase(),
  };
}
