// API routes: PATCH+DELETE /api/dashboard/iam/members/[email]
// Role change and removal (spec §5) — write:user-gated + D10 role-hierarchy
// guardrail + the last-Owner guardrail, both enforced authoritatively by
// changeAdminMemberRole / removeAdminMember (src/lib/db/
// adminUserOrganization.ts), which independently re-derive the caller's role
// from the roster on every call (D11's "next request" freshness — this
// route never passes a callerRole param, only callerEmail). Their typed
// result codes are mapped here to distinct responses: the D10 hierarchy
// violation is a plain 403; the last-Owner guardrail is a SPECIFIC 409 with
// `code: "last-owner"` so the UI can render the guardrail's own inline copy,
// not a generic error toast (design §4).
import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import {
  changeAdminMemberRole,
  removeAdminMember,
} from "@/lib/db/adminUserOrganization";
import { resolveActiveOrganizationId } from "@/lib/org-membership";

const COOKIE_NAME = "session";

const LAST_OWNER_MESSAGE =
  "This organization must have at least one Owner. Promote another member to Owner first, then try this change again.";

const patchSchema = z.object({
  role: z.enum(["owner", "admin", "editor", "viewer"]),
});

type CallerScope =
  | { ok: true; organizationId: string; callerEmail: string }
  | { ok: false; status: 401 | 403; error: string };

async function resolveCallerScope(): Promise<CallerScope> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return { ok: false, status: 401, error: "Missing session" };
  }

  const decoded = await decodeUser(token);
  if ("error" in decoded) {
    return { ok: false, status: 401, error: decoded.error };
  }

  const callerEmail = decoded.email.toLowerCase();
  const userDoc = await getAdminUserByEmail(callerEmail);
  const organizationId = resolveActiveOrganizationId(userDoc);
  if (!userDoc || !organizationId) {
    return { ok: false, status: 403, error: "Missing organization scope" };
  }
  if (!userDoc.permissions.includes("write:user")) {
    return { ok: false, status: 403, error: "Missing write:user permission" };
  }

  return { ok: true, organizationId, callerEmail };
}

// Maps changeAdminMemberRole/removeAdminMember's typed rejection codes to
// the response shape the role-change and remove dialogs (design §4) expect.
// Returns null on success (ok:true) so callers fall through to their own
// 200 response.
function mapMutationRejection(
  result: { ok: true } | { ok: false; code: string },
): Response | null {
  if (result.ok) return null;

  switch (result.code) {
    case "TARGET_NOT_FOUND":
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    case "HIERARCHY_VIOLATION":
      return NextResponse.json(
        { error: "You don't have permission to do that." },
        { status: 403 },
      );
    case "LAST_OWNER":
      return NextResponse.json(
        { error: LAST_OWNER_MESSAGE, code: "last-owner" },
        { status: 409 },
      );
    case "CALLER_NOT_AUTHORIZED":
      return NextResponse.json(
        { error: "You don't have permission to do that." },
        { status: 403 },
      );
    default:
      return NextResponse.json(
        { error: "Unable to complete the request" },
        { status: 500 },
      );
  }
}

interface RouteContext {
  params: Promise<{ email: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const scope = await resolveCallerScope();
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const { email: rawEmail } = await context.params;
  const targetEmail = decodeURIComponent(rawEmail).toLowerCase();

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await changeAdminMemberRole({
    organizationId: scope.organizationId,
    callerEmail: scope.callerEmail,
    targetEmail,
    newRole: parsed.data.role,
  });

  const rejection = mapMutationRejection(result);
  if (rejection) return rejection;

  return NextResponse.json({ role: parsed.data.role });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const scope = await resolveCallerScope();
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const { email: rawEmail } = await context.params;
  const targetEmail = decodeURIComponent(rawEmail).toLowerCase();

  const result = await removeAdminMember({
    organizationId: scope.organizationId,
    callerEmail: scope.callerEmail,
    targetEmail,
  });

  const rejection = mapMutationRejection(result);
  if (rejection) return rejection;

  return NextResponse.json({ ok: true });
}
