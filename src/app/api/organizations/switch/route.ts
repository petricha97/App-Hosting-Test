// API route: POST /api/organizations/switch
// Server-side active-org switch. Under the M2 firestore.rules the client can
// update its own organizationId/organizationRole (roster-constrained) but NOT
// the permissions mirror — a client-only switch would leave stale permissions
// until the next server-side membership write. This route runs the switch
// through setAdminUserActiveOrganization, which validates the target against
// the authoritative roster and re-stamps organizationId, organizationRole AND
// permissions atomically.
import { NextResponse } from "next/server";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import { setAdminUserActiveOrganization } from "@/lib/db/adminUserOrganization";
import { resolveCallerToken } from "@/lib/server/caller-token";

const switchPayloadSchema = z.object({
  organizationId: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  const token = await resolveCallerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Missing session" }, { status: 401 });
  }

  const decoded = await decodeUser(token);
  if ("error" in decoded) {
    return NextResponse.json({ error: decoded.error }, { status: 401 });
  }
  if (!decoded.email || !decoded.email.includes("@")) {
    return NextResponse.json(
      { error: "Your account has no email address" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = switchPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await setAdminUserActiveOrganization(
    decoded.email.toLowerCase(),
    parsed.data.organizationId,
  );

  if (!result.ok) {
    if (result.reason === "user-not-found") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    // not-a-member: the roster does not confirm this membership.
    return NextResponse.json(
      { error: "You don't have access to this organization" },
      { status: 403 },
    );
  }

  return NextResponse.json({
    organizationId: parsed.data.organizationId,
    role: result.role,
  });
}
