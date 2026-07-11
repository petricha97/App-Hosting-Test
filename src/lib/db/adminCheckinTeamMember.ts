// Server-side data access layer for the CheckinTeamMember root collection.
// Spec: agents/docs/specs/m5-attendees-checkin.md (M5-T4 team members,
// M5-T5 scanner auth).
//
// SERVER-ONLY (firestore.rules deny-all, no client repo pair) — the doc
// carries access-code HASHES, the scanner's credential material.
//
// Credential contract (mirrors the draft-token pattern):
// - the ROUTE mints the raw access code (generateScannerAccessCode,
//   src/lib/qr/scanner-session.ts), returns it ONCE in the create response
//   body, and passes only hashScannerAccessCode(code) into this module —
//   the raw code NEVER reaches the DAL or Firestore;
// - the code -> session exchange resolves through
//   getAdminActiveCheckinTeamMemberByAccessCodeHash: revoked and unknown
//   codes are both null (generic error, no oracle — spec T5 AC-1);
// - revoke = isActive:false. Session tokens are stateless HMACs, so
//   resolve/confirm routes MUST re-load the member (org-scoped getter) and
//   reject inactive ones — that read is what makes revocation immediate
//   (T4 AC-6 / T5 AC-9).
import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { constantTimeStringEqual } from "@/lib/draft-token";
import type { CheckinTeamMemberDoc, WithId } from "@/types/collection";

export const CHECKIN_TEAM_MEMBER_COLLECTION = "CheckinTeamMember";

// Team-member list page size (door staff counts are small; bounded anyway).
export const CHECKIN_TEAM_MEMBER_LIST_LIMIT = 50;

function teamMemberCol() {
  return adminDb.collection(CHECKIN_TEAM_MEMBER_COLLECTION);
}

export interface CreateAdminCheckinTeamMemberInput {
  organizationId: string;
  eventId: string;
  name: string;
  deviceLabel: string;
  // hashScannerAccessCode(rawCode) — hash only, never the raw code.
  accessCodeHash: string;
}

// Creates an active member (auto ID). lastSeenAt starts null ("Never used").
export async function createAdminCheckinTeamMember(
  input: CreateAdminCheckinTeamMemberInput,
): Promise<WithId<CheckinTeamMemberDoc>> {
  const doc: CheckinTeamMemberDoc = {
    organizationId: input.organizationId,
    eventId: input.eventId,
    name: input.name,
    deviceLabel: input.deviceLabel,
    accessCodeHash: input.accessCodeHash,
    isActive: true,
    lastSeenAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const ref = await teamMemberCol().add(doc);
  return { id: ref.id, ...doc };
}

// Team members card list: newest first, org-scoped in the query, bounded.
// Served by the composite index CheckinTeamMember: eventId ASC,
// organizationId ASC, createdAt DESC. Returns revoked members too — the
// route decides whether to render or drop them (design prefers removal).
export async function listAdminCheckinTeamMembersForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
}): Promise<WithId<CheckinTeamMemberDoc>[]> {
  const snap = await teamMemberCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .orderBy("createdAt", "desc")
    .limit(input.limit ?? CHECKIN_TEAM_MEMBER_LIST_LIMIT)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as CheckinTeamMemberDoc),
  }));
}

// Fetches a single member scoped to event + org. Returns null when the doc
// does not exist OR belongs to another event/org — callers 404 on null
// (IDOR-safe). Also THE revocation check for scanner sessions: resolve/
// confirm must call this and 401 when isActive is false.
export async function getAdminCheckinTeamMemberForEvent(input: {
  teamMemberId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<CheckinTeamMemberDoc> | null> {
  const snap = await teamMemberCol().doc(input.teamMemberId).get();
  if (!snap.exists) return null;

  const doc = { id: snap.id, ...(snap.data() as CheckinTeamMemberDoc) };
  if (
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

// The access-code -> session exchange lookup (spec T5 AC-1), event-scoped
// (eventIds are globally unique, and the exchange route resolves the event
// doc — and therefore the tenant — before calling this). ACTIVE members
// only: a revoked member's code is indistinguishable from an unknown one
// (null either way — no oracle). Equality-only query, served by
// single-field index merging; the matched hash is re-checked constant-time
// (credential comparisons never rely on the query engine alone).
export async function getAdminActiveCheckinTeamMemberByAccessCodeHash(input: {
  eventId: string;
  accessCodeHash: string;
}): Promise<WithId<CheckinTeamMemberDoc> | null> {
  const snap = await teamMemberCol()
    .where("eventId", "==", input.eventId)
    .where("accessCodeHash", "==", input.accessCodeHash)
    .where("isActive", "==", true)
    .limit(1)
    .get();

  if (snap.empty) return null;

  const doc = {
    id: snap.docs[0].id,
    ...(snap.docs[0].data() as CheckinTeamMemberDoc),
  };
  if (!constantTimeStringEqual(doc.accessCodeHash, input.accessCodeHash)) {
    return null;
  }

  return doc;
}

// Revoke (T4: per-row revoke = isActive:false; the doc is kept for the
// checkedInBy audit trail). Org-scoped: cross-org/missing -> false (route
// 404s). Idempotent — revoking twice is a no-op second time.
export async function revokeAdminCheckinTeamMember(input: {
  teamMemberId: string;
  eventId: string;
  organizationId: string;
}): Promise<boolean> {
  const existing = await getAdminCheckinTeamMemberForEvent(input);
  if (!existing) return false;

  if (existing.isActive) {
    await teamMemberCol().doc(input.teamMemberId).update({
      isActive: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return true;
}

// Bumps lastSeenAt (session exchange + each resolve/confirm). Caller
// contract: invoke ONLY after the member was verified this request (access
// code exchange or org/event-scoped load under a valid session token) —
// this method trusts the id and performs a blind update.
export async function touchAdminCheckinTeamMemberLastSeen(
  teamMemberId: string,
): Promise<void> {
  await teamMemberCol().doc(teamMemberId).update({
    lastSeenAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
