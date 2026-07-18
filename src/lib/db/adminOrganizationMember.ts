// Server-side data access layer for the OrganizationMember root collection —
// the D12 reverse-index this ticket adds. Spec:
// agents/docs/specs/m8-real-iam.md D12 / §7.
//
// WHY THIS EXISTS: UserDoc.organizations[] is embedded PER-USER, not
// reverse-indexed — there is no correct "list every member of org X" query
// against User alone (agents/docs/specs/m7-scheduled-reports.md D2 named
// this exact gap and explicitly deferred it to "M8-T1 (real IAM)... not this
// ticket's job"). This module closes that gap with one new root collection,
// keyed deterministically so every roster mutation can keep it in sync
// without a separate lookup-then-write step.
//
// SERVER-ONLY (firestore.rules deny-all, no client repo pair) — same
// posture as EmailDefinition/ReportSchedule: this is organizer-management
// data, never client-readable directly (it's projected through
// GET /api/dashboard/iam instead).
//
// SYNC CONTRACT: every function here that WRITES takes an already-open
// `Transaction` and performs no I/O of its own beyond that transaction —
// callers (src/lib/db/adminUserOrganization.ts) pair each call with their
// own User/Organization writes in the SAME transaction, so this index can
// never drift out of sync with the authoritative embedded roster (spec §7
// AC-3). Reads (list/get/count) are plain, non-transactional queries — safe
// to call from routes directly (e.g. the GET /api/dashboard/iam roster
// endpoint) without opening a transaction.
import "server-only";

import type { Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { createAdminCollectionApi } from "@/lib/db/adminBase";
import type { OrganizationMemberDoc, WithId } from "@/types/collection";

export const ORGANIZATION_MEMBER_COLLECTION = "OrganizationMember";

// Reused for the plain (non-composite) "every member of this org" listing —
// per spec D12: "adminBase.ts's existing findWhere/findMany, no new
// base-layer code needed."
const organizationMemberApi = createAdminCollectionApi<OrganizationMemberDoc>(
  ORGANIZATION_MEMBER_COLLECTION,
);

// Generous bound, well above any realistic org size at this product's
// current scale — a genuine Firestore `.limit()` on the raw collection read
// used by countAdminOrganizationOwnersInTransaction below (never an
// unbounded read), matching REPORT_SCHEDULE_LIST_LIMIT /
// EMAIL_DEFINITION_LIST_LIMIT's precedent in this codebase.
export const ORGANIZATION_MEMBER_LIST_LIMIT = 2000;

function organizationMemberCol() {
  return adminDb.collection(ORGANIZATION_MEMBER_COLLECTION);
}

// Deterministic doc id (spec D12): organizationId + "_" + lowercased email —
// one reverse-index row per (org, member) pair. Recomputing this id is how
// every roster mutation locates "this member's index row" without a query.
export function organizationMemberId(
  organizationId: string,
  email: string,
): string {
  return `${organizationId}_${email.trim().toLowerCase()}`;
}

function organizationMemberRef(organizationId: string, email: string) {
  return organizationMemberCol().doc(
    organizationMemberId(organizationId, email),
  );
}

// ============================================================================
// Transactional writes — called FROM WITHIN an already-open transaction by
// every roster-mutating function in adminUserOrganization.ts. Never opens
// its own transaction.
// ============================================================================

export interface PutAdminOrganizationMemberInput {
  organizationId: string;
  email: string;
  role: OrganizationMemberDoc["role"];
  name: string;
  status: OrganizationMemberDoc["status"];
}

// Full overwrite (tx.set, not tx.update/merge) — a role change or a name
// change fully replaces the row rather than leaving stale fields behind.
// Idempotent: calling this twice for the same (org, email) in sequence just
// overwrites the same doc, never creates a duplicate (the doc id IS the
// tuple key).
export function putAdminOrganizationMemberInTransaction(
  tx: Transaction,
  input: PutAdminOrganizationMemberInput,
): void {
  const email = input.email.trim().toLowerCase();
  const doc: OrganizationMemberDoc = {
    organizationId: input.organizationId,
    email,
    role: input.role,
    name: input.name,
    status: input.status,
  };
  tx.set(organizationMemberRef(input.organizationId, email), doc);
}

// Removes one member's reverse-index row — paired with the roster removal
// in removeAdminMember (adminUserOrganization.ts), same transaction.
export function deleteAdminOrganizationMemberInTransaction(
  tx: Transaction,
  organizationId: string,
  email: string,
): void {
  tx.delete(organizationMemberRef(organizationId, email));
}

// ============================================================================
// Reads — plain queries, safe to call outside a transaction.
// ============================================================================

// Single member's index row, doc-id read — null when the org/email pair has
// no row (never a member, or already removed).
export async function getAdminOrganizationMember(
  organizationId: string,
  email: string,
): Promise<WithId<OrganizationMemberDoc> | null> {
  const snap = await organizationMemberRef(organizationId, email).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as OrganizationMemberDoc) };
}

// Every current member of an org — a plain `where(organizationId == X)`
// query (spec D12's whole point: this query did not correctly exist before
// this ticket). Powers GET /api/dashboard/iam's roster response.
export async function listAdminOrganizationMembers(
  organizationId: string,
): Promise<WithId<OrganizationMemberDoc>[]> {
  return organizationMemberApi.findWhere("organizationId", organizationId);
}

// The composite query the last-Owner guardrail needs (spec §5: "count the
// org's current Owners via the D12 reverse-index query,
// where(organizationId==X, role=='owner')"). A genuine two-field equality
// query (not expressible through adminBase's single-filter findMany), so it
// bypasses createAdminCollectionApi here — same precedent as
// adminCheckinTeamMember.ts's own multi-`.where()` chain against `adminDb`
// directly. Composite index: firestore.indexes.json
// (OrganizationMember: organizationId ASC, role ASC).
function organizationOwnersQuery(organizationId: string) {
  return organizationMemberCol()
    .where("organizationId", "==", organizationId)
    .where("role", "==", "owner")
    .limit(ORGANIZATION_MEMBER_LIST_LIMIT);
}

// Non-transactional owner count — convenience for read-only call sites.
export async function countAdminOrganizationOwners(
  organizationId: string,
): Promise<number> {
  const snap = await organizationOwnersQuery(organizationId).get();
  return snap.docs.length;
}

// Transactional owner count — the last-Owner guardrail
// (changeAdminMemberRole / removeAdminMember, adminUserOrganization.ts)
// reads this INSIDE its own transaction (via tx.get(query)) so the count is
// part of the same consistent snapshot as the roster mutation it's gating,
// not a stale read from before the transaction opened. Must be called
// before any write in that transaction (Firestore requires all reads before
// all writes).
export async function countAdminOrganizationOwnersInTransaction(
  tx: Transaction,
  organizationId: string,
): Promise<number> {
  const snap = await tx.get(organizationOwnersQuery(organizationId));
  return snap.docs.length;
}
