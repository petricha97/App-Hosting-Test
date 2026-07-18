// Server-side data access layer for the Invitation root collection —
// M8-T1's per-email, pre-assigned-role invite. Spec:
// agents/docs/specs/m8-real-iam.md §3/§4/D7/D10.
//
// SERVER-ONLY (firestore.rules deny-all, no client repo pair) — same
// posture as EmailDefinition/ReportSchedule: organizer-management data, not
// client-readable directly.
//
// Doc id is DETERMINISTIC: invitationId(organizationId, lowercasedEmail) =
// sha256(["Invitation", organizationId, lowercasedEmail]) — same tuple-hash
// family as reportScheduleId.ts / emailDefinitionId.ts, co-located in this
// file (not a separate pure module) since this is the only consumer. One
// live invitation per (org, email) pair BY CONSTRUCTION — "re-inviting" is
// an upsert onto this same id (spec §3 AC-1), never a duplicate/second
// "resend" endpoint.
//
// DEPENDENCY DIRECTION (deliberate, avoids a circular import): this module
// depends on adminOrganizationMember.ts (the D12 reverse-index) for its
// "is this email already an active member" and "is the caller an
// owner/admin" checks — NOT on adminUserOrganization.ts, even though that
// module also exposes an equivalent membership lookup
// (getAdminUserMembership). adminUserOrganization.ts's own accept flow
// (acceptAdminInvitation) needs to import THIS module (to resolve a token to
// an invitation) — importing adminUserOrganization.ts from here would create
// a cycle. adminOrganizationMember.ts is a leaf module (no dependency on
// either), so routing both checks through it breaks the cycle cleanly.
import "server-only";

import { createHash } from "node:crypto";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { getAdminOrganizationMember } from "@/lib/db/adminOrganizationMember";
import { generateInviteToken } from "@/lib/invite-utils";
import type {
  InvitationDoc,
  OrganizationRole,
  WithId,
} from "@/types/collection";

export const INVITATION_COLLECTION = "Invitation";

// Named, changeable constant (spec §3) — matches the
// MAX_CATCHUP_PERIODS/MAX_RECIPIENTS_PER_SCHEDULE naming convention already
// established in M7-T3.
export const INVITATION_EXPIRY_DAYS = 14;

// Generous bound for the org-scoped listing — a genuine Firestore
// `.limit()` (never an unbounded read), matching
// REPORT_SCHEDULE_LIST_LIMIT/EMAIL_DEFINITION_LIST_LIMIT's precedent.
export const INVITATION_LIST_LIMIT = 500;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function invitationCol() {
  return adminDb.collection(INVITATION_COLLECTION);
}

// Deterministic doc id (spec §3): sha256(["Invitation", organizationId,
// lowercasedEmail]).
export function invitationId(organizationId: string, email: string): string {
  const material = JSON.stringify([
    "Invitation",
    organizationId,
    email.trim().toLowerCase(),
  ]);
  return createHash("sha256").update(material, "utf8").digest("hex");
}

// "expired" is NEVER stored — derived at read/accept time from
// `expiresAt < now` (spec §3), same "derived, not invented" discipline as
// the abandoned-draft/isAbandoned convention.
export function isAdminInvitationExpired(
  invitation: Pick<InvitationDoc, "expiresAt">,
): boolean {
  return invitation.expiresAt.toMillis() < Date.now();
}

function isManagerRole(role: OrganizationRole): boolean {
  return role === "owner" || role === "admin";
}

// ============================================================================
// Reads
// ============================================================================

// Deterministic-id read scoped to (org, email) — the natural lookup for
// "does this org already have a live invitation for this email."
export async function getAdminInvitationForOrganization(input: {
  organizationId: string;
  email: string;
}): Promise<WithId<InvitationDoc> | null> {
  const id = invitationId(input.organizationId, input.email);
  const snap = await invitationCol().doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as InvitationDoc) };
}

// Token-to-invitation lookup (spec §4) — the accept flow's caller has only
// the opaque bearer token, never the deterministic (org, email) id. A plain
// single-field equality query (`token ==`) needs no composite index (same
// "pure equality, no orderBy" precedent as
// adminCheckinTeamMember.ts's accessCodeHash lookup).
export async function getAdminInvitationByToken(
  token: string,
): Promise<WithId<InvitationDoc> | null> {
  if (!token) return null;
  const snap = await invitationCol().where("token", "==", token).limit(1).get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as InvitationDoc) };
}

// Every invitation on file for an org (any status) — powers
// GET /api/dashboard/iam's `invitations` field; the route/UI decides which
// statuses to surface (spec §2: pending ones render the amber "Invited"
// badge).
export async function listAdminInvitationsForOrganization(
  organizationId: string,
): Promise<WithId<InvitationDoc>[]> {
  const snap = await invitationCol()
    .where("organizationId", "==", organizationId)
    .limit(INVITATION_LIST_LIMIT)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as InvitationDoc) }));
}

// ============================================================================
// Create / upsert (spec §3)
// ============================================================================

export type CreateOrUpdateAdminInvitationResult =
  | { ok: true; created: boolean; invitation: WithId<InvitationDoc> }
  // Caller isn't a manager (Owner/Admin) of this org — defense in depth, the
  // route already gates write:user before calling this.
  | { ok: false; code: "CALLER_NOT_AUTHORIZED" }
  // D10: only an Owner may invite someone as "admin".
  | { ok: false; code: "HIERARCHY_VIOLATION" }
  // Spec §3 AC-2: the invited email is already an active member of THIS
  // org — rejected before any write. A member of a DIFFERENT org is
  // unaffected (spec §3 AC-3, this check is scoped to organizationId only).
  | { ok: false; code: "ALREADY_MEMBER" };

export async function createOrUpdateAdminInvitation(input: {
  organizationId: string;
  callerEmail: string;
  email: string;
  role: InvitationDoc["role"];
}): Promise<CreateOrUpdateAdminInvitationResult> {
  const callerEmail = input.callerEmail.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();

  const callerMember = await getAdminOrganizationMember(
    input.organizationId,
    callerEmail,
  );
  if (!callerMember || !isManagerRole(callerMember.role)) {
    return { ok: false, code: "CALLER_NOT_AUTHORIZED" };
  }
  if (input.role === "admin" && callerMember.role !== "owner") {
    return { ok: false, code: "HIERARCHY_VIOLATION" };
  }

  const existingMember = await getAdminOrganizationMember(
    input.organizationId,
    email,
  );
  if (existingMember) {
    return { ok: false, code: "ALREADY_MEMBER" };
  }

  const id = invitationId(input.organizationId, email);
  const ref = invitationCol().doc(id);
  // Bridge cast: Admin Timestamp is wire-identical to the client Timestamp
  // the collection types use (seconds/nanoseconds) but structurally lacks
  // toJSON — same documented cast adminUserOrganization.ts /
  // adminEventPromotion.ts already use for this exact mismatch.
  const expiresAt = Timestamp.fromMillis(
    Date.now() + INVITATION_EXPIRY_DAYS * ONE_DAY_MS,
  ) as unknown as InvitationDoc["expiresAt"];

  return adminDb.runTransaction<CreateOrUpdateAdminInvitationResult>(
    async (tx) => {
      const snap = await tx.get(ref);
      const prior = snap.exists ? (snap.data() as InvitationDoc) : null;

      // UPSERT (spec §3 AC-1): a second invite for the same (org, email)
      // refreshes role/token/expiresAt on the SAME doc — never a duplicate.
      // Full overwrite (tx.set, never a merge-update) so a stale
      // accepted/revoked cycle's acceptedAt/acceptedBy never survives into
      // the fresh "pending" doc.
      const doc: InvitationDoc = {
        organizationId: input.organizationId,
        email,
        role: input.role,
        status: "pending",
        token: generateInviteToken(),
        invitedBy: callerEmail,
        createdAt: prior?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt,
      };

      if (prior) {
        tx.set(ref, doc);
      } else {
        tx.create(ref, doc);
      }

      return {
        ok: true,
        created: prior === null,
        invitation: { id, ...doc },
      };
    },
  );
}

// ============================================================================
// Revoke (spec §3) — idempotent: revoking an already-accepted or
// already-revoked invitation is a no-op success, never an error (AC-6).
// ============================================================================

export type RevokeAdminInvitationResult =
  | { ok: true }
  // NOT_FOUND doubles as the cross-org answer (route 404s, IDOR-safe
  // convention, spec §7 AC-2).
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "CALLER_NOT_AUTHORIZED" }
  // D10: revoking a pending Admin-role invite is Owner-only.
  | { ok: false; code: "HIERARCHY_VIOLATION" };

export async function revokeAdminInvitation(input: {
  organizationId: string;
  callerEmail: string;
  email: string;
}): Promise<RevokeAdminInvitationResult> {
  const callerEmail = input.callerEmail.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();

  const callerMember = await getAdminOrganizationMember(
    input.organizationId,
    callerEmail,
  );
  if (!callerMember || !isManagerRole(callerMember.role)) {
    return { ok: false, code: "CALLER_NOT_AUTHORIZED" };
  }

  const existing = await getAdminInvitationForOrganization({
    organizationId: input.organizationId,
    email,
  });
  if (!existing) return { ok: false, code: "NOT_FOUND" };

  if (existing.status !== "pending") {
    // Idempotent no-op success — already accepted or already revoked.
    // Checked BEFORE the D10 hierarchy gate (spec §3 AC-6: idempotency is
    // unconditional, no carve-out for a role mismatch on a
    // no-longer-pending invite).
    return { ok: true };
  }

  if (existing.role === "admin" && callerMember.role !== "owner") {
    return { ok: false, code: "HIERARCHY_VIOLATION" };
  }

  await invitationCol().doc(existing.id).update({
    status: "revoked",
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
}
