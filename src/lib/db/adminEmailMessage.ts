// Server-side data access layer for the EmailMessage root collection — the
// email outbox / send log. Spec: agents/docs/specs/m6-email-infrastructure.md
// (§2, §5).
//
// SERVER-ONLY: no client repo pair exists and firestore.rules denies all
// client access (recipient PII + rendered message bodies). All reads/writes
// go through server code — T1 itself adds NO API route (enqueue is invoked
// by T3's hooks / T2's manual-send routes, which gate session -> org ->
// getAdminEventForOrganization -> write:events first).
//
// Doc IDs are DETERMINISTIC: emailMessageId(org, event, kind,
// recipientEmailLower, dedupeKey) (src/lib/db/emailMessageId.ts) — the
// create-if-absent transaction makes duplicate enqueues (double-click,
// replayed hook, concurrent calls) collapse onto EXACTLY ONE doc, so the
// system never double-sends by construction (M5-T1 attendee precedent).
//
// Status machine (transaction-guarded here, nowhere else):
//   queued -> sent      (markAdminEmailMessageSent)
//   queued -> failed    (markAdminEmailMessageFailed)
//   failed -> queued    (retryFailedEmailMessage — EXPLICIT retry only;
//                        no automatic/scheduled retry until M6-T3)
// "sent" is TERMINAL: a sent doc is never re-sent or mutated — a deliberate
// re-send is a NEW logical send under a new dedupeKey. The rendered
// subject/bodyHtml/bodyText snapshot is frozen at enqueue and NEVER updated
// by any transition (audit parity with OrderSnapshot).
//
// attemptCount counts COMPLETED transport attempts: it is incremented by
// the sent/failed transitions (one per attempt), not by enqueue or retry —
// so after enqueue->failed->retry->sent it reads 2.
import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { emailMessageId } from "@/lib/db/emailMessageId";
import type {
  EmailMessageDoc,
  EmailMessageStatus,
  WithId,
} from "@/types/collection";

export const EMAIL_MESSAGE_COLLECTION = "EmailMessage";

// Outbox page size (M3/M5 convention: limit + load-more cursor).
export const EMAIL_MESSAGE_LIST_LIMIT = 50;

// lastError.message bound — no stack traces, no PII, no unbounded provider
// payloads in Firestore (spec §2 AC-3).
export const EMAIL_LAST_ERROR_MAX_CHARS = 500;

export function truncateEmailError(message: string): string {
  const singleLine = message.replace(/\s+/g, " ").trim();
  return singleLine.length <= EMAIL_LAST_ERROR_MAX_CHARS
    ? singleLine
    : `${singleLine.slice(0, EMAIL_LAST_ERROR_MAX_CHARS - 1)}…`;
}

function emailMessageCol() {
  return adminDb.collection(EMAIL_MESSAGE_COLLECTION);
}

// ============================================================================
// Create-if-absent enqueue (deterministic id)
// ============================================================================

export interface CreateAdminEmailMessageInput {
  organizationId: string;
  eventId: string;
  definitionId: string | null;
  kind: string;
  dedupeKey: string;
  // Email MUST already be validated + lowercased by the send service
  // (emailRecipientSchema) — the DAL never receives raw client input.
  recipient: { name: string; email: string };
  attendeeId: string | null;
  submissionId: string | null;
  from: { name: string; address: string };
  replyTo: string | null;
  // Rendered snapshot — frozen here, never rewritten.
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

export interface CreateAdminEmailMessageResult {
  messageId: string;
  message: WithId<EmailMessageDoc>;
  // false = this logical send already has a doc (replayed hook /
  // double-click / concurrent call); the existing doc is returned untouched
  // and the caller MUST NOT invoke the transport again.
  created: boolean;
}

export async function createAdminEmailMessageIfAbsent(
  input: CreateAdminEmailMessageInput,
): Promise<CreateAdminEmailMessageResult> {
  const messageId = emailMessageId({
    organizationId: input.organizationId,
    eventId: input.eventId,
    kind: input.kind,
    recipientEmail: input.recipient.email,
    dedupeKey: input.dedupeKey,
  });
  const ref = emailMessageCol().doc(messageId);

  return adminDb.runTransaction<CreateAdminEmailMessageResult>(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      return {
        messageId,
        message: { id: snap.id, ...(snap.data() as EmailMessageDoc) },
        created: false,
      };
    }

    const doc: EmailMessageDoc = {
      organizationId: input.organizationId,
      eventId: input.eventId,
      definitionId: input.definitionId,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      recipient: {
        name: input.recipient.name,
        email: input.recipient.email.toLowerCase(),
      },
      attendeeId: input.attendeeId,
      submissionId: input.submissionId,
      from: input.from,
      replyTo: input.replyTo,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      bodyText: input.bodyText,
      status: "queued",
      attemptCount: 0,
      lastError: null,
      providerMessageId: null,
      provider: "dev-outbox",
      queuedAt: FieldValue.serverTimestamp(),
      sentAt: null,
      failedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // tx.create backstops the read-write race: the loser aborts and replays
    // as a duplicate (exactly one doc, ever).
    tx.create(ref, doc);

    return {
      messageId,
      message: { id: messageId, ...doc },
      created: true,
    };
  });
}

// ============================================================================
// Status transitions (transaction-guarded)
// ============================================================================

export type EmailMessageTransitionResult =
  | { ok: true }
  | {
      ok: false;
      code: "NOT_FOUND" | "INVALID_STATUS";
      status?: EmailMessageStatus;
    };

// queued -> sent. Any other current status is a typed no-op with ZERO
// writes ("sent" is terminal; a failed doc must go through retry first).
// Org/event-scoped like every other transition: cross-tenant ids answer
// NOT_FOUND with zero writes (IDOR-safe, M5 convention).
export async function markAdminEmailMessageSent(input: {
  messageId: string;
  eventId: string;
  organizationId: string;
  providerMessageId: string | null;
}): Promise<EmailMessageTransitionResult> {
  const ref = emailMessageCol().doc(input.messageId);

  return adminDb.runTransaction<EmailMessageTransitionResult>(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: "NOT_FOUND" };

    const doc = snap.data() as EmailMessageDoc;
    if (
      doc.eventId !== input.eventId ||
      doc.organizationId !== input.organizationId
    ) {
      // Cross-tenant ids are indistinguishable from missing ones.
      return { ok: false, code: "NOT_FOUND" };
    }

    if (doc.status !== "queued") {
      return { ok: false, code: "INVALID_STATUS", status: doc.status };
    }

    tx.update(ref, {
      status: "sent" satisfies EmailMessageStatus,
      providerMessageId: input.providerMessageId,
      attemptCount: doc.attemptCount + 1,
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  });
}

// queued -> failed, with the (truncated) transport error captured. Any
// other current status is a typed no-op with ZERO writes.
// Org/event-scoped like every other transition: cross-tenant ids answer
// NOT_FOUND with zero writes (IDOR-safe, M5 convention).
export async function markAdminEmailMessageFailed(input: {
  messageId: string;
  eventId: string;
  organizationId: string;
  errorMessage: string;
}): Promise<EmailMessageTransitionResult> {
  const ref = emailMessageCol().doc(input.messageId);

  return adminDb.runTransaction<EmailMessageTransitionResult>(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: "NOT_FOUND" };

    const doc = snap.data() as EmailMessageDoc;
    if (
      doc.eventId !== input.eventId ||
      doc.organizationId !== input.organizationId
    ) {
      // Cross-tenant ids are indistinguishable from missing ones.
      return { ok: false, code: "NOT_FOUND" };
    }

    if (doc.status !== "queued") {
      return { ok: false, code: "INVALID_STATUS", status: doc.status };
    }

    tx.update(ref, {
      status: "failed" satisfies EmailMessageStatus,
      lastError: {
        message: truncateEmailError(input.errorMessage),
        at: FieldValue.serverTimestamp(),
      },
      attemptCount: doc.attemptCount + 1,
      failedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  });
}

export type RetryFailedEmailMessageResult =
  | { ok: true; message: WithId<EmailMessageDoc> }
  // NOT_RETRYABLE: the doc is "sent" (terminal) or already "queued" —
  // ZERO writes either way (spec §2 AC-4). NOT_FOUND doubles as the
  // cross-org/cross-event answer (IDOR-safe, M5 convention).
  | {
      ok: false;
      code: "NOT_FOUND" | "NOT_RETRYABLE";
      status?: EmailMessageStatus;
    };

// EXPLICIT, idempotent retry transition: failed -> queued, nothing else.
// The send service (src/lib/email/send-service.ts retryEmailMessage)
// re-invokes the transport after this commits; attemptCount is incremented
// by the attempt's own sent/failed transition, not here.
export async function retryFailedEmailMessage(input: {
  messageId: string;
  eventId: string;
  organizationId: string;
}): Promise<RetryFailedEmailMessageResult> {
  const ref = emailMessageCol().doc(input.messageId);

  return adminDb.runTransaction<RetryFailedEmailMessageResult>(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: "NOT_FOUND" };

    const doc = snap.data() as EmailMessageDoc;
    if (
      doc.eventId !== input.eventId ||
      doc.organizationId !== input.organizationId
    ) {
      // Cross-tenant ids are indistinguishable from missing ones.
      return { ok: false, code: "NOT_FOUND" };
    }

    if (doc.status !== "failed") {
      return { ok: false, code: "NOT_RETRYABLE", status: doc.status };
    }

    tx.update(ref, {
      status: "queued" satisfies EmailMessageStatus,
      queuedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      message: { id: snap.id, ...doc, status: "queued" },
    };
  });
}

// ============================================================================
// Reads (T2's outbox screen consumes these)
// ============================================================================

// Single message scoped to event + org — null when missing OR when the doc
// belongs to another event/org (callers 404 on null, IDOR-safe).
export async function getAdminEmailMessageForEvent(input: {
  messageId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<EmailMessageDoc> | null> {
  const snap = await emailMessageCol().doc(input.messageId).get();
  if (!snap.exists) return null;

  const doc = { id: snap.id, ...(snap.data() as EmailMessageDoc) };
  if (
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

// Outbox list: newest first, org-scoped IN THE QUERY, bounded (limit 50 +
// createdAt-millis cursor), optional Firestore-side status / kind filters.
// Indexes (firestore.indexes.json):
//   base:     EmailMessage eventId ASC, organizationId ASC, createdAt DESC
//   + status: EmailMessage eventId ASC, organizationId ASC, status ASC, createdAt DESC
//   + kind:   EmailMessage eventId ASC, organizationId ASC, kind ASC, createdAt DESC
// (status AND kind together is NOT a supported list shape in T1 — no index;
// same documented constraint style as the M5 roster.)
export async function listAdminEmailMessagesForEvent(input: {
  eventId: string;
  organizationId: string;
  status?: EmailMessageStatus;
  kind?: string;
  limit?: number;
  startAfterCreatedAtMs?: number;
}): Promise<WithId<EmailMessageDoc>[]> {
  if (input.status !== undefined && input.kind !== undefined) {
    throw new Error(
      "[adminEmailMessage] status and kind filters cannot be combined " +
        "(no composite index registered for that shape).",
    );
  }

  let query = emailMessageCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId);

  if (input.status !== undefined) {
    query = query.where("status", "==", input.status);
  }
  if (input.kind !== undefined) {
    query = query.where("kind", "==", input.kind);
  }

  let ordered = query.orderBy("createdAt", "desc");
  if (input.startAfterCreatedAtMs !== undefined) {
    ordered = ordered.startAfter(
      Timestamp.fromMillis(input.startAfterCreatedAtMs),
    );
  }

  const snap = await ordered
    .limit(input.limit ?? EMAIL_MESSAGE_LIST_LIMIT)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as EmailMessageDoc) }));
}

// Outbox counts via Firestore AGGREGATE count() (M5 pattern — never a
// page-length count): computed server-side from index entries, correct and
// cheap at any outbox size. Equality-only filters — index merging serves
// the status/kind variants.
export async function countAdminEmailMessagesForEvent(input: {
  eventId: string;
  organizationId: string;
  status?: EmailMessageStatus;
  kind?: string;
}): Promise<number> {
  let query = emailMessageCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId);

  if (input.status !== undefined) {
    query = query.where("status", "==", input.status);
  }
  if (input.kind !== undefined) {
    query = query.where("kind", "==", input.kind);
  }

  const snap = await query.count().get();
  return snap.data().count;
}
