// Shared gating for the PUBLIC scanner resolve/confirm routes (M5-T5).
// Both routes must apply the identical sequence, so it lives in one place:
//
//   1. verify the signed session token against THIS event (expired, forged,
//      tampered, cross-event -> uniform 401 SESSION_EXPIRED — back to the
//      access-code gate, no oracle, T5 AC-2);
//   2. rate-limit per session/member (60/min, T5 AC-10) — after signature
//      verification so garbage tokens can't fill member buckets, before any
//      Firestore read;
//   3. re-load the member and re-check isActive — token verification is
//      STATELESS, this read is what makes revocation immediate (T5 AC-9);
//   4. hand back the tenant scope + member for the actual work. Callers bump
//      lastSeenAt after their work succeeds.
import "server-only";

import { extractOrganizationIdFromPath } from "@/features/event/utils";
import { getAdminPublishedEventById } from "@/lib/db/adminEvent";
import { getAdminCheckinTeamMemberForEvent } from "@/lib/db/adminCheckinTeamMember";
import { verifyScannerSessionToken } from "@/lib/qr/scanner-session";
import { checkRateLimit } from "@/lib/rate-limit";
import type { CheckinTeamMemberDoc, WithId } from "@/types/collection";

export const SCANNER_SESSION_RATE_LIMIT = 60;

export type ScannerSessionScope =
  | {
      ok: true;
      organizationId: string;
      member: WithId<CheckinTeamMemberDoc>;
    }
  | {
      ok: false;
      status: 401 | 404 | 429;
      error: string;
      // SESSION_EXPIRED sends the client back to the access-code gate.
      code?: "SESSION_EXPIRED";
      retryAfterSeconds?: number;
    };

const SESSION_DENIED: ScannerSessionScope = {
  ok: false,
  status: 401,
  error: "Session expired — enter your code again.",
  code: "SESSION_EXPIRED",
};

export async function resolveScannerSessionScope(input: {
  eventId: string;
  sessionToken: string;
  // Distinguishes the resolve and confirm buckets.
  routeName: string;
}): Promise<ScannerSessionScope> {
  const verified = verifyScannerSessionToken({
    token: input.sessionToken,
    eventId: input.eventId,
  });
  if (!verified.valid) return SESSION_DENIED;

  const rate = checkRateLimit(
    `${input.routeName}:${verified.teamMemberId}`,
    { limit: SCANNER_SESSION_RATE_LIMIT },
  );
  if (!rate.allowed) {
    return {
      ok: false,
      status: 429,
      error: "Too many scans — wait a moment.",
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  }

  const event = await getAdminPublishedEventById(input.eventId);
  const organizationId = event
    ? extractOrganizationIdFromPath(event.organizationPath)
    : null;
  if (!event || !organizationId) {
    return { ok: false, status: 404, error: "Scanner is not available." };
  }

  const member = await getAdminCheckinTeamMemberForEvent({
    teamMemberId: verified.teamMemberId,
    eventId: input.eventId,
    organizationId,
  });
  // Revoked and vanished members deny exactly like an expired session — a
  // revoked device learns nothing beyond "log in again" (T5 AC-9).
  if (!member || !member.isActive) return SESSION_DENIED;

  return { ok: true, organizationId, member };
}
