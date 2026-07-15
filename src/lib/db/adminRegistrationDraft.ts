// Server-side data access layer for the RegistrationDraft root collection.
// Spec: agents/docs/specs/m3-registration-paths.md (M3-T3 draft persistence,
// M3-T5 abandoned tracking).
//
// SERVER-ONLY collection (registrant PII + draft-token hashes): no client
// repo pair exists and firestore.rules denies all client access.
//
// Access model: the signed draft token (src/lib/draft-token.ts) is the SOLE
// capability for the public flow. Routes verify the token's HMAC first
// (verifyDraftToken), then load the draft through
// getAdminRegistrationDraftByIdAndTokenHash — which re-checks the stored
// SHA-256 token hash and the eventId binding. A bare draftId grants nothing
// (T5 AC-5). Admin surfaces (M5-T3 abandoned tab, manual delete) go through
// the org-scoped getters instead, gated write:events by their routes.
//
// PII minimization (Q3 locked): only step-1 answers, selections and
// name/email denorms are stored. Payment details and promo code TEXT never
// reach this module (promotionId only).
import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { constantTimeStringEqual } from "@/lib/draft-token";
import type {
  RegistrationDraftDoc,
  RegistrationDraftStep,
  WithId,
} from "@/types/collection";

export const REGISTRATION_DRAFT_COLLECTION = "RegistrationDraft";

// THE single abandoned threshold (spec T5 AC-8): a draft whose updatedAt is
// older than this counts as abandoned. Referenced by M5-T3's Abandoned tab
// and M6-T3's "+24h" nudge — import it, never copy the number.
export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

// Abandoned tab / report reads (M5-T3) — bounded page, not a full scan.
export const REGISTRATION_DRAFT_LIST_LIMIT = 50;

// Enough matches to prove "referenced" for the path-delete 409 (spec T1:
// bounded reference queries, limit 5).
const REFERENCING_DRAFTS_LIMIT = 5;

function registrationDraftCol() {
  return adminDb.collection(REGISTRATION_DRAFT_COLLECTION);
}

export interface CreateAdminRegistrationDraftInput {
  // Minted by generateDraftId() (src/lib/draft-token.ts) BEFORE the write so
  // the signed token + hash exist at create time. Never a Firestore auto ID.
  draftId: string;
  organizationId: string;
  eventId: string;
  pathId: string;
  formId: string;
  // SHA-256 hex of the signed token (hashDraftToken) — never the raw token.
  draftTokenHash: string;
  // Validated step-1 answers (non-commerce fields).
  stepAnswers: Record<string, string>;
  // Denormalized from stepAnswers by the route; "" when not present.
  firstName?: string;
  lastName?: string;
  email?: string;
}

// Creates the draft when step 1 completes (a draft abandoned mid-step-1
// simply never exists — consent-light by design, T5 AC-2). Field list is
// explicit; selections start null, attempt starts at 1, lastStepReached is
// always "personal_info" (later steps go through the allow-list update).
// Uses .create() so an (astronomically unlikely) draftId collision fails
// loudly instead of overwriting someone else's draft.
export async function createAdminRegistrationDraft(
  input: CreateAdminRegistrationDraftInput,
): Promise<string> {
  await registrationDraftCol()
    .doc(input.draftId)
    .create({
      organizationId: input.organizationId,
      eventId: input.eventId,
      pathId: input.pathId,
      formId: input.formId,
      draftTokenHash: input.draftTokenHash,
      lastStepReached: "personal_info" satisfies RegistrationDraftStep,
      stepAnswers: input.stepAnswers,
      ticketTypeId: null,
      registrationTypeId: null,
      promotionId: null,
      attempt: 1,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      email: input.email ?? "",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

  return input.draftId;
}

// THE sole public-flow access path (T3 AC-3). Returns null when the draft
// does not exist, belongs to another event, or the token hash does not match
// the stored one — all indistinguishable to the caller (routes 404).
// tokenHash = hashDraftToken(rawToken); compare is constant-time.
export async function getAdminRegistrationDraftByIdAndTokenHash(input: {
  draftId: string;
  eventId: string;
  tokenHash: string;
}): Promise<WithId<RegistrationDraftDoc> | null> {
  const snap = await registrationDraftCol().doc(input.draftId).get();
  if (!snap.exists) return null;

  const doc = { id: snap.id, ...(snap.data() as RegistrationDraftDoc) };
  if (doc.eventId !== input.eventId) return null;
  if (!constantTimeStringEqual(doc.draftTokenHash, input.tokenHash)) {
    return null;
  }

  return doc;
}

// Admin-surface fetch (M5-T3 detail / manual delete route), org-scoped.
// Returns null cross-org/cross-event — callers 404 (IDOR-safe). NOT for the
// public flow: public reads must present the token.
export async function getAdminRegistrationDraftForEvent(input: {
  draftId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<RegistrationDraftDoc> | null> {
  const snap = await registrationDraftCol().doc(input.draftId).get();
  if (!snap.exists) return null;

  const doc = { id: snap.id, ...(snap.data() as RegistrationDraftDoc) };
  if (
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

export interface UpdateAdminRegistrationDraftStepInput {
  lastStepReached?: RegistrationDraftStep;
  stepAnswers?: Record<string, string>;
  ticketTypeId?: string | null;
  registrationTypeId?: string | null;
  // Resolved EventPromotion id ONLY — never promo code text (T5 AC-4).
  promotionId?: string | null;
  firstName?: string;
  lastName?: string;
  email?: string;
}

// Allow-list step update (public flow steps 2-3, after token verification).
// organizationId / eventId / pathId / formId / draftTokenHash / attempt /
// createdAt are server-owned and unreachable here regardless of what the
// caller passes — a step write can never re-point a draft at another
// event/path or rotate its token. Bumps updatedAt (which is what the
// abandoned threshold measures).
export async function updateAdminRegistrationDraftStep(
  draftId: string,
  input: UpdateAdminRegistrationDraftStepInput,
): Promise<void> {
  const data: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (input.lastStepReached !== undefined) {
    data.lastStepReached = input.lastStepReached;
  }
  if (input.stepAnswers !== undefined) data.stepAnswers = input.stepAnswers;
  if (input.ticketTypeId !== undefined) data.ticketTypeId = input.ticketTypeId;
  if (input.registrationTypeId !== undefined) {
    data.registrationTypeId = input.registrationTypeId;
  }
  if (input.promotionId !== undefined) data.promotionId = input.promotionId;
  if (input.firstName !== undefined) data.firstName = input.firstName;
  if (input.lastName !== undefined) data.lastName = input.lastName;
  if (input.email !== undefined) data.email = input.email;

  await registrationDraftCol().doc(draftId).update(data);
}

// Finalize-attempt counter bump — called ONLY after a PAYMENT_FAILED result
// so the retry gets a fresh idempotency key ("reg:" + draftId + ":" + attempt)
// while double-clicks keep colliding onto the current one (M2 contract).
export async function incrementAdminRegistrationDraftAttempt(
  draftId: string,
): Promise<void> {
  await registrationDraftCol()
    .doc(draftId)
    .update({
      attempt: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

// Hard delete. Two callers: (1) finalize — ONLY after the Order AND the
// FormData doc both exist (T3 AC-11); (2) the manual admin purge route
// (write:events). No auto-delete/TTL job exists in M3 (retention is an
// M6-T3/M8 decision).
export async function deleteAdminRegistrationDraft(
  draftId: string,
): Promise<void> {
  await registrationDraftCol().doc(draftId).delete();
}

// A draft page item with the DERIVED abandoned flag (never stored, T5 AC-6).
export type AdminRegistrationDraftListItem = WithId<RegistrationDraftDoc> & {
  isAbandoned: boolean;
};

// Lists the event's drafts newest-updated first, org-scoped in the query,
// bounded — the M5-T3 Abandoned tab / M6-T3 staleness read. Served by the
// composite index RegistrationDraft: eventId ASC, organizationId ASC,
// updatedAt DESC. isAbandoned = now - updatedAt > ABANDONED_AFTER_MS,
// computed per item (nowMs injectable for tests).
//
// startAfterUpdatedAtMs (M6-T3 addition): cursor for the abandoned-24h
// trigger's paged sweep (agents/docs/specs/m6-lifecycle-triggers.md §8
// volume safety) — same "load more" convention as every other admin list's
// cursor param, added here rather than forked into a parallel query.
export async function getAdminRegistrationDraftsForEvent(input: {
  eventId: string;
  organizationId: string;
  limit?: number;
  nowMs?: number;
  startAfterUpdatedAtMs?: number;
}): Promise<AdminRegistrationDraftListItem[]> {
  let query = registrationDraftCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .orderBy("updatedAt", "desc");

  if (input.startAfterUpdatedAtMs !== undefined) {
    query = query.startAfter(Timestamp.fromMillis(input.startAfterUpdatedAtMs));
  }

  const snap = await query
    .limit(input.limit ?? REGISTRATION_DRAFT_LIST_LIMIT)
    .get();

  const nowMs = input.nowMs ?? Date.now();

  return snap.docs.map((d) => {
    const doc = d.data() as RegistrationDraftDoc;
    const updatedAtMs =
      typeof doc.updatedAt === "object" &&
      doc.updatedAt !== null &&
      "toMillis" in doc.updatedAt
        ? doc.updatedAt.toMillis()
        : nowMs;

    return {
      id: d.id,
      ...doc,
      isAbandoned: nowMs - updatedAtMs > ABANDONED_AFTER_MS,
    };
  });
}

// Delete protection for registration paths (spec T1: BLOCK, limit 5):
// drafts in this event that walked the given path. Equality-only query —
// served by single-field index merging, no composite needed.
export async function getAdminRegistrationDraftsReferencingPath(input: {
  eventId: string;
  organizationId: string;
  pathId: string;
  limit?: number;
}): Promise<WithId<RegistrationDraftDoc>[]> {
  const snap = await registrationDraftCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .where("pathId", "==", input.pathId)
    .limit(input.limit ?? REFERENCING_DRAFTS_LIMIT)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as RegistrationDraftDoc),
  }));
}
