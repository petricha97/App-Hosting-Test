// Shared auth + tenancy resolution for the M1 registration API routes.
// Mirrors the promotions route convention: session cookie -> decoded user ->
// org scope -> write:events permission -> org-owned event. Cross-org and
// missing events both resolve to 404 so event existence never leaks across
// tenants (IDOR-safe).
import "server-only";

import { cookies } from "next/headers";

import decodeUser from "@/lib/auth-utils";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { resolveActiveOrganizationId } from "@/lib/org-membership";
import type { EventDoc, WithId } from "@/types/collection";

const COOKIE_NAME = "session";

export type RegistrationRouteScope =
  | {
      ok: true;
      organizationId: string;
      event: WithId<EventDoc>;
      // The User doc id (lowercased email) — the dashboard scanner records it
      // as checkedInBy { kind: "admin", userId } (M5-T5 AC-8). Additive field;
      // pre-M5 consumers ignore it.
      userId: string;
    }
  | { ok: false; error: string; status: 401 | 403 | 404 };

export async function resolveRegistrationRouteScope(
  eventId: string,
): Promise<RegistrationRouteScope> {
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
  // SEC M2 Finding 1: userDoc.organizationId (the active org) is
  // client-writable via the org switcher — it is only a valid tenant key when
  // the server-locked organizations[] roster confirms membership. A mismatch
  // (spoofed active org) resolves to null and gets 403 here.
  const organizationId = resolveActiveOrganizationId(userDoc);
  if (!organizationId) {
    return { ok: false, error: "Missing organization scope", status: 403 };
  }

  // Every consumer of this helper is a mutating route (POST/PATCH/DELETE);
  // reads go through the server pages, which gate on org membership only —
  // the same split the promotions routes use. Mirror the sibling mutating
  // event routes (promotions, status, page, publish): members without
  // write:events are view-only and get 403.
  // userDoc.permissions is safe to gate on ONLY because firestore.rules deny
  // client writes to it (field-diff lock on the User doc) — it is stamped by
  // the server-side membership flows (adminUserOrganization.ts).
  if (!userDoc?.permissions.includes("write:events")) {
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
