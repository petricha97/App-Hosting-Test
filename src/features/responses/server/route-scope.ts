// Auth + tenancy resolution for the M3-T4 responses API routes.
//
// Two scopes live here because the responses surface splits differently from
// the M1/M2 event routes:
// - resolveResponsesReadScope(eventId): session -> org membership -> org-owned
//   event, WITHOUT write:events — the "load more" list GET must work for the
//   same audience that can render the server page (view-only members
//   included). Mirrors the server pages' gating exactly.
// - resolveResponsesOrgWriteScope(): session -> org membership ->
//   write:events, WITHOUT an event — the workspace-level CSV export (spec T4:
//   export is write:events-gated) which spans all events in the org.
// Event-scoped mutations (status transitions, per-event export) keep using
// resolveRegistrationRouteScope (write:events + event ownership).
import "server-only";

import { cookies } from "next/headers";

import decodeUser from "@/lib/auth-utils";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { resolveActiveOrganizationId } from "@/lib/org-membership";
import type { EventDoc, WithId } from "@/types/collection";

const COOKIE_NAME = "session";

type BaseScope =
  | { ok: true; organizationId: string; userId: string }
  | { ok: false; error: string; status: 401 | 403 | 404 };

// Shared session -> org resolution (same trust chain as
// resolveRegistrationRouteScope: the active org id is only a valid tenant key
// when the server-locked organizations[] roster confirms membership).
async function resolveSessionOrganization(): Promise<
  | {
      ok: true;
      organizationId: string;
      permissions: string[];
      userId: string;
    }
  | { ok: false; error: string; status: 401 | 403 }
> {
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

  return {
    ok: true,
    organizationId,
    permissions: userDoc?.permissions ?? [],
    userId: decodedUser.email.toLowerCase(),
  };
}

export type ResponsesReadScope =
  | { ok: true; organizationId: string; event: WithId<EventDoc> }
  | { ok: false; error: string; status: 401 | 403 | 404 };

// Read-level scope for the per-event list GET: org membership + org-owned
// event (404 cross-org, IDOR-safe) — no write:events, matching the server
// page that rendered the first page of rows.
export async function resolveResponsesReadScope(
  eventId: string,
): Promise<ResponsesReadScope> {
  const session = await resolveSessionOrganization();
  if (!session.ok) {
    return session;
  }

  const event = await getAdminEventForOrganization(
    eventId,
    session.organizationId,
  );
  if (!event) {
    return { ok: false, error: "Event not found", status: 404 };
  }

  return { ok: true, organizationId: session.organizationId, event };
}

// Org-level write scope for the workspace CSV export (write:events, no
// event). Permission gating on userDoc.permissions is safe because
// firestore.rules deny client writes to it (see route-scope.ts, M1).
export async function resolveResponsesOrgWriteScope(): Promise<BaseScope> {
  const session = await resolveSessionOrganization();
  if (!session.ok) {
    return session;
  }

  if (!session.permissions.includes("write:events")) {
    return {
      ok: false,
      error: "Missing write:events permission",
      status: 403,
    };
  }

  return {
    ok: true,
    organizationId: session.organizationId,
    userId: session.userId,
  };
}
