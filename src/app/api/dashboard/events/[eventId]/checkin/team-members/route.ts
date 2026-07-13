// API route: POST /api/dashboard/events/[eventId]/checkin/team-members
// Adds a door-scanner team member (M5-T4). write:events-gated, 404 cross-org
// (T4 AC-8).
//
// Credential contract (T4 AC-4/AC-5): THIS route mints the access code
// (>=128 bits via generateScannerAccessCode), returns it EXACTLY ONCE in the
// response body, and hands only its SHA-256 hash to the DAL — the raw code
// never reaches src/lib/db/ or Firestore, and no later GET can recover it.
import { NextResponse } from "next/server";
import { z } from "zod";

import { serializeTeamMember } from "@/features/checkin/utils";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { createAdminCheckinTeamMember } from "@/lib/db/adminCheckinTeamMember";
import {
  generateScannerAccessCode,
  hashScannerAccessCode,
} from "@/lib/qr/scanner-session";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const CreateTeamMemberSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  // Optional per prototype ("Door A" style) — stored as "" when omitted.
  deviceLabel: z.string().trim().max(120).optional().default(""),
});

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = CreateTeamMemberSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const accessCode = generateScannerAccessCode();
  const member = await createAdminCheckinTeamMember({
    organizationId: scope.organizationId,
    eventId,
    name: parsed.data.name,
    deviceLabel: parsed.data.deviceLabel,
    accessCodeHash: hashScannerAccessCode(accessCode),
  });

  // The ONE-TIME code display (add-dialog phase 2). Never persisted raw,
  // never retrievable again.
  return NextResponse.json(
    { member: serializeTeamMember(member), accessCode },
    { status: 201 },
  );
}
