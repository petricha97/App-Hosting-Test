// Server-side data access layer for the FormData root collection
// (registration submissions / "responses").
//
// M3 extensions (spec: agents/docs/specs/m3-registration-paths.md, T3/T4):
// - status machine writes: transitionAdminFormDataStatus enforces the
//   forward-only new < pending < reviewed < accepted machine inside a
//   transaction (pure rules in src/lib/db/formDataStatus.ts) and fires the
//   accept hook stub at most once;
// - crash-recoverable finalize create: createAdminFormDataForDraft is a
//   create-if-absent upsert at the DETERMINISTIC id derived from the draftId
//   (src/lib/db/formDataId.ts) — a crash between the Order write and the
//   FormData write heals on retry;
// - status-filtered, bounded, Firestore-side list queries for the responses
//   tables (no in-memory status filtering — spec T4 AC-5). NOTE: a status
//   filter of "new" matches only docs physically carrying the field; legacy
//   pre-M3 docs (no status field) appear under "Any" and READ as "new" via
//   applyFormDataReadDefaults — documented divergence, no backfill.
//
// FormData is server-only: firestore.rules denies all client access (the
// legacy client repo formData.ts is rule-dead).
import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { createAdminCollectionApi } from "@/lib/db/adminBase";
import { formDataIdFromDraftId } from "@/lib/db/formDataId";
import { hashQrToken, mintQrToken } from "@/lib/qr/qr-token";
import {
  canTransitionFormDataStatus,
  readFormDataStatus,
} from "@/lib/db/formDataStatus";
import { onSubmissionAccepted } from "@/features/responses/on-submission-accepted";
import type { FormDataDoc, FormDataStatus, WithId } from "@/types/collection";

export const FORM_DATA_COLLECTION = "FormData";

// Responses tables page size (spec T4 AC-9: limit 50 + "load more" cursor).
export const FORM_DATA_LIST_LIMIT = 50;

// Enough matches to prove "referenced" for the path-delete 409 (spec T1:
// bounded reference queries, limit 5).
const REFERENCING_FORM_DATA_LIMIT = 5;

const formDataAdminApi =
  createAdminCollectionApi<FormDataDoc>(FORM_DATA_COLLECTION);

export const {
  create: createAdminFormData,
  set: setAdminFormData,
  getById: getAdminFormDataById,
  getAll: getAdminFormData,
  update: updateAdminFormData,
  remove: deleteAdminFormData,
  findWhere: findAdminFormDataByField,
  findMany: findAdminManyFormData,
} = formDataAdminApi;

function formDataCol() {
  return adminDb.collection(FORM_DATA_COLLECTION);
}

// Legacy workspace read (pre-M3): unbounded org fetch + in-memory sort.
// Kept for existing callers; new list surfaces should use
// listAdminFormDataForOrganization below (bounded, Firestore-ordered).
export async function getAdminFormDataForOrganization(organizationId: string) {
  const responses = await findAdminFormDataByField(
    "organizationId",
    organizationId,
  );

  return [...responses].sort((left, right) => {
    const leftSeconds =
      typeof left.submittedAt === "object" &&
      left.submittedAt !== null &&
      "seconds" in left.submittedAt
        ? Number(left.submittedAt.seconds)
        : 0;
    const rightSeconds =
      typeof right.submittedAt === "object" &&
      right.submittedAt !== null &&
      "seconds" in right.submittedAt
        ? Number(right.submittedAt.seconds)
        : 0;

    return rightSeconds - leftSeconds;
  });
}

// ============================================================================
// M3-T4 — bounded, status-filterable list reads (responses tables + CSV)
// ============================================================================

// Per-event responses list, newest first. Indexes:
//   without status: FormData eventId ASC, organizationId ASC, submittedAt DESC
//   with status:    FormData eventId ASC, organizationId ASC, status ASC, submittedAt DESC
// Cursor = the last row's submittedAt millis ("load more", spec T4 AC-9).
export async function listAdminFormDataForEvent(input: {
  eventId: string;
  organizationId: string;
  status?: FormDataStatus;
  limit?: number;
  startAfterSubmittedAtMs?: number;
}): Promise<WithId<FormDataDoc>[]> {
  let query = formDataCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId);

  if (input.status !== undefined) {
    query = query.where("status", "==", input.status);
  }

  let ordered = query.orderBy("submittedAt", "desc");
  if (input.startAfterSubmittedAtMs !== undefined) {
    ordered = ordered.startAfter(
      Timestamp.fromMillis(input.startAfterSubmittedAtMs),
    );
  }

  const snap = await ordered.limit(input.limit ?? FORM_DATA_LIST_LIMIT).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as FormDataDoc) }));
}

// Workspace (all-events) responses list, newest first. Indexes:
//   without status: FormData organizationId ASC, submittedAt DESC (baseline #6)
//   with status:    FormData organizationId ASC, status ASC, submittedAt DESC
export async function listAdminFormDataForOrganization(input: {
  organizationId: string;
  status?: FormDataStatus;
  limit?: number;
  startAfterSubmittedAtMs?: number;
}): Promise<WithId<FormDataDoc>[]> {
  let query = formDataCol().where("organizationId", "==", input.organizationId);

  if (input.status !== undefined) {
    query = query.where("status", "==", input.status);
  }

  let ordered = query.orderBy("submittedAt", "desc");
  if (input.startAfterSubmittedAtMs !== undefined) {
    ordered = ordered.startAfter(
      Timestamp.fromMillis(input.startAfterSubmittedAtMs),
    );
  }

  const snap = await ordered.limit(input.limit ?? FORM_DATA_LIST_LIMIT).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as FormDataDoc) }));
}

// Fetches a single response scoped to event + org. Returns null when the doc
// does not exist OR belongs to another event/org — callers should 404 on
// null (IDOR-safe).
export async function getAdminFormDataForEvent(input: {
  responseId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<FormDataDoc> | null> {
  const snap = await formDataCol().doc(input.responseId).get();
  if (!snap.exists) return null;

  const doc = { id: snap.id, ...(snap.data() as FormDataDoc) };
  if (
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

// Delete protection for registration paths (spec T1: BLOCK, limit 5):
// submissions in this event that came through the given path. Equality-only
// query — served by single-field index merging, no composite needed.
export async function getAdminFormDataReferencingPath(input: {
  eventId: string;
  organizationId: string;
  pathId: string;
  limit?: number;
}): Promise<WithId<FormDataDoc>[]> {
  const snap = await formDataCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .where("pathId", "==", input.pathId)
    .limit(input.limit ?? REFERENCING_FORM_DATA_LIMIT)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as FormDataDoc) }));
}

// ============================================================================
// M3-T3 — finalize create (deterministic id, crash-recoverable)
// ============================================================================

export interface CreateAdminFormDataForDraftInput {
  organizationId: string;
  eventId: string;
  // The RegistrationDraft id — the FormData doc id is DERIVED from it
  // (formDataIdFromDraftId), which is what makes finalize retries idempotent.
  draftId: string;
  formId: string;
  // Final submission map (step-1 answers + display-only ticketLabel/promo
  // code entries per spec T2 backward-compat note).
  submission: Record<string, string>;
  orderId: string;
  pathId: string;
  ticketLabel: string | null;
}

export interface CreateAdminFormDataForDraftResult {
  formDataId: string;
  formData: WithId<FormDataDoc>;
  // false = a submission for this draft already existed (crash-recovery
  // retry); the existing doc is returned untouched.
  created: boolean;
}

// Create-if-absent upsert at the deterministic id (crash-recovery contract:
// placeOrder replays idempotently, then this write lands on the same doc —
// exactly one FormData per draft, ever). Arrives status "new" with
// orderId/pathId/ticketLabel populated (spec T4 AC-7).
//
// M5-T1: the finalize path also stamps qrTokenHash here — the QR token is
// DETERMINISTIC (src/lib/qr/qr-token.ts: eventId + the formDataId derived
// below), so it is mintable before the doc exists, the finalize route can
// re-mint the identical token for the confirmation qrSvg, and the Attendee
// created at accept inherits the same hash. Only the SHA-256 hash is stored.
// In production a missing QR_TOKEN_SECRET makes this throw (fail-closed by
// design — finalize breaks loudly rather than issuing unverifiable passes).
export async function createAdminFormDataForDraft(
  input: CreateAdminFormDataForDraftInput,
): Promise<CreateAdminFormDataForDraftResult> {
  const formDataId = formDataIdFromDraftId({
    organizationId: input.organizationId,
    eventId: input.eventId,
    draftId: input.draftId,
  });
  const qrTokenHash = hashQrToken(
    mintQrToken({ eventId: input.eventId, formDataId }),
  );
  const ref = formDataCol().doc(formDataId);

  return adminDb.runTransaction<CreateAdminFormDataForDraftResult>(
    async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        return {
          formDataId,
          formData: { id: snap.id, ...(snap.data() as FormDataDoc) },
          created: false,
        };
      }

      const doc: FormDataDoc = {
        formId: input.formId,
        eventId: input.eventId,
        organizationId: input.organizationId,
        submission: input.submission,
        submittedAt: FieldValue.serverTimestamp(),
        status: "new",
        orderId: input.orderId,
        pathId: input.pathId,
        ticketLabel: input.ticketLabel,
        statusUpdatedAt: null,
        acceptedAt: null,
        attendeeCreated: false,
        qrTokenHash,
      };

      // create() (not set) — backstops a race between the read above and the
      // write: the loser aborts and retries as a repeat.
      tx.create(ref, doc);

      return {
        formDataId,
        formData: { id: formDataId, ...doc },
        created: true,
      };
    },
  );
}

// ============================================================================
// M5-T1 — accept-hook completion marker
// ============================================================================

// Flips attendeeCreated after the Attendee doc exists, and (for legacy flat
// submissions that never went through finalize) backfills the freshly minted
// qrTokenHash. Idempotent: re-running the hook re-applies the same values.
// Called ONLY by onSubmissionAccepted — status "accepted" with
// attendeeCreated false is the "hook pending" signal this write clears.
export async function markAdminFormDataAttendeeCreated(input: {
  formDataId: string;
  // Pass ONLY when the FormData doc lacked a stored hash (legacy) — an
  // existing finalize-stamped hash is never rewritten.
  qrTokenHash?: string;
}): Promise<void> {
  const update: Record<string, unknown> = { attendeeCreated: true };
  if (input.qrTokenHash !== undefined) update.qrTokenHash = input.qrTokenHash;

  await formDataCol().doc(input.formDataId).update(update);
}

// ============================================================================
// M3-T4 — status transition (forward-only, accept hook at most once)
// ============================================================================

export type TransitionAdminFormDataStatusResult =
  // acceptHookFailed (M5 S-1): true when the transition to "accepted"
  // COMMITTED but the post-commit attendee hook threw — the submission is
  // accepted with attendeeCreated still false ("hook pending"). Callers that
  // promise an Attendee (manual registration) must heal by re-invoking the
  // idempotent onSubmissionAccepted directly; the generic status route
  // treats the accept itself as the success it is.
  | { ok: true; response: WithId<FormDataDoc>; acceptHookFailed?: boolean }
  // NOT_FOUND -> route 404 (missing or cross-org/cross-event — IDOR-safe);
  // INVALID_TRANSITION -> route 409 (backward move, same-status repeat, or
  // anything out of "accepted" — terminal in M3).
  | { ok: false; code: "NOT_FOUND" | "INVALID_TRANSITION"; message: string };

export interface TransitionAdminFormDataStatusInput {
  responseId: string;
  eventId: string;
  organizationId: string;
  to: FormDataStatus;
  // Test/DI seam; defaults to the M3 no-op stub
  // (src/features/responses/on-submission-accepted.ts) that M5-T1 replaces
  // with attendee creation.
  onAccepted?: (submission: WithId<FormDataDoc>) => void | Promise<void>;
}

// Transitions a response's status inside a transaction:
// - read + tenant check (null-equivalent NOT_FOUND cross-org/event);
// - current status via read-time default (legacy docs count as "new");
// - forward-only machine check (canTransitionFormDataStatus) — backward,
//   repeat and out-of-accepted moves fail INVALID_TRANSITION, no write;
// - write: status + statusUpdatedAt (+ acceptedAt exactly once when the
//   target is "accepted").
// The accept hook fires AFTER the transaction commits, and at most once per
// submission: re-accepting fails the machine check, so the hook is
// unreachable a second time (spec T4 AC-3).
export async function transitionAdminFormDataStatus(
  input: TransitionAdminFormDataStatusInput,
): Promise<TransitionAdminFormDataStatusResult> {
  const ref = formDataCol().doc(input.responseId);

  const result =
    await adminDb.runTransaction<TransitionAdminFormDataStatusResult>(
      async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          return {
            ok: false,
            code: "NOT_FOUND",
            message: "Response not found.",
          };
        }

        const doc = snap.data() as FormDataDoc;
        if (
          doc.eventId !== input.eventId ||
          doc.organizationId !== input.organizationId
        ) {
          // Cross-tenant ids are indistinguishable from missing ones.
          return {
            ok: false,
            code: "NOT_FOUND",
            message: "Response not found.",
          };
        }

        const current = readFormDataStatus(doc);
        if (!canTransitionFormDataStatus(current, input.to)) {
          return {
            ok: false,
            code: "INVALID_TRANSITION",
            message: `Cannot move a response from "${current}" to "${input.to}".`,
          };
        }

        const update: Record<string, FormDataStatus | FieldValue> = {
          status: input.to,
          statusUpdatedAt: FieldValue.serverTimestamp(),
        };
        if (input.to === "accepted") {
          update.acceptedAt = FieldValue.serverTimestamp();
        }

        tx.update(ref, update);

        return {
          ok: true,
          response: {
            id: snap.id,
            ...doc,
            status: input.to,
          },
        };
      },
    );

  if (result.ok && input.to === "accepted") {
    const hook = input.onAccepted ?? onSubmissionAccepted;
    try {
      await hook(result.response);
    } catch (error) {
      // M5 S-1: the accept commit stands — a submission is NEVER un-accepted
      // because its side-effect hook crashed. Log loudly (this submission is
      // now "accepted" + attendeeCreated:false, invisible on the roster until
      // healed) and tell the caller instead of 500ing a committed accept.
      console.error(
        `[adminFormData] accept hook failed for submission ${input.responseId}; accepted with attendeeCreated pending`,
        error,
      );
      return { ...result, acceptHookFailed: true };
    }
  }

  return result;
}
