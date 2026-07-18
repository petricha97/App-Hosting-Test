// Server-side data access layer for the Attendee root collection.
// Spec: agents/docs/specs/m5-attendees-checkin.md (M5-T1/T2/T4/T5).
//
// Attendees are SERVER-ONLY: no client repo pair exists and firestore.rules
// denies all client access (registrant PII + QR token hashes). Every admin
// surface goes through write:events-gated routes; the public scanner goes
// through the scanner-session-token routes — never a bare attendeeId from
// the client (all resolution flows through the QR token, T5 AC-12).
//
// Doc IDs are DETERMINISTIC: attendeeIdFromSubmissionId(org, event,
// submissionId) (src/lib/db/attendeeId.ts) — the accept hook's
// create-if-absent transaction makes duplicate accepts collapse onto exactly
// one doc, and the scanner's resolve flow is a direct doc get (token ->
// formDataId -> attendee id), no query needed.
//
// Check-in is an IDEMPOTENT, NEVER-OVERWRITING flip: the first confirm
// records checkedInAt/checkedInBy; every later confirm returns the ORIGINAL
// values with zero writes (spec T5 AC-6 — race-safe inside a transaction).
import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { attendeeIdFromSubmissionId } from "@/lib/db/attendeeId";
import { constantTimeStringEqual } from "@/lib/draft-token";
import type {
  AttendeeCheckedInBy,
  AttendeeCheckInState,
  AttendeeDoc,
  AttendeeStatus,
  WithId,
} from "@/types/collection";

export const ATTENDEE_COLLECTION = "Attendee";

// Roster page size (spec T2: limit 50 + load-more cursor, M3 convention).
export const ATTENDEE_LIST_LIMIT = 50;

function attendeeCol() {
  return adminDb.collection(ATTENDEE_COLLECTION);
}

// ============================================================================
// M5-T1 — create-if-absent at the deterministic id (accept hook)
// ============================================================================

export interface CreateAdminAttendeeInput {
  organizationId: string;
  eventId: string;
  // The FormData doc id — the Attendee doc id is DERIVED from it.
  submissionId: string;
  orderId: string | null;
  pathId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  jobTitle: string;
  registrationTypeId: string | null;
  registrationTypeLabel: string;
  ticketTypeId: string | null;
  ticketLabel: string;
  // hashQrToken(mintQrToken(...)) — hash only, never the raw token.
  qrTokenHash: string;
}

export interface CreateAdminAttendeeResult {
  attendeeId: string;
  attendee: WithId<AttendeeDoc>;
  // false = an attendee for this submission already existed (replayed hook /
  // concurrent accept); the existing doc is returned untouched.
  created: boolean;
}

// Create-if-absent upsert at the deterministic id. Replays return the
// existing doc with ZERO writes; the tx.create() backstops the read-write
// race (the loser aborts and retries as a repeat). status initializes
// "accepted", checkInState "not-arrived", checkedInAt/checkedInBy null
// (spec T1 AC-8).
export async function createAdminAttendeeIfAbsent(
  input: CreateAdminAttendeeInput,
): Promise<CreateAdminAttendeeResult> {
  const attendeeId = attendeeIdFromSubmissionId({
    organizationId: input.organizationId,
    eventId: input.eventId,
    submissionId: input.submissionId,
  });
  const ref = attendeeCol().doc(attendeeId);

  return adminDb.runTransaction<CreateAdminAttendeeResult>(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      return {
        attendeeId,
        attendee: { id: snap.id, ...(snap.data() as AttendeeDoc) },
        created: false,
      };
    }

    const doc: AttendeeDoc = {
      organizationId: input.organizationId,
      eventId: input.eventId,
      submissionId: input.submissionId,
      orderId: input.orderId,
      pathId: input.pathId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      company: input.company,
      jobTitle: input.jobTitle,
      registrationTypeId: input.registrationTypeId,
      registrationTypeLabel: input.registrationTypeLabel,
      ticketTypeId: input.ticketTypeId,
      ticketLabel: input.ticketLabel,
      status: "accepted",
      checkInState: "not-arrived",
      checkedInAt: null,
      checkedInBy: null,
      qrTokenHash: input.qrTokenHash,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    tx.create(ref, doc);

    return {
      attendeeId,
      attendee: { id: attendeeId, ...doc },
      created: true,
    };
  });
}

// ============================================================================
// Reads
// ============================================================================

// Fetches a single attendee scoped to event + org. Returns null when the doc
// does not exist OR belongs to another event/org — callers 404 on null
// (IDOR-safe).
export async function getAdminAttendeeForEvent(input: {
  attendeeId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<AttendeeDoc> | null> {
  const snap = await attendeeCol().doc(input.attendeeId).get();
  if (!snap.exists) return null;

  const doc = { id: snap.id, ...(snap.data() as AttendeeDoc) };
  if (
    doc.eventId !== input.eventId ||
    doc.organizationId !== input.organizationId
  ) {
    return null;
  }

  return doc;
}

// Scanner resolve convenience: the attendee born from a given submission
// (deterministic id -> direct doc get, no query). The caller derives
// organizationId from the event doc, so cross-event/cross-org token replay
// still dead-ends here (the derived id simply doesn't exist).
export async function getAdminAttendeeBySubmissionId(input: {
  submissionId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<AttendeeDoc> | null> {
  return getAdminAttendeeForEvent({
    attendeeId: attendeeIdFromSubmissionId({
      organizationId: input.organizationId,
      eventId: input.eventId,
      submissionId: input.submissionId,
    }),
    eventId: input.eventId,
    organizationId: input.organizationId,
  });
}

// Event-scoped lookup by stored QR token hash (revocation seam / secondary
// resolve path). Equality-only query — served by single-field index merging,
// no composite needed. The returned doc's hash is re-checked constant-time
// (belt and braces: the query already matched on equality, but the DAL never
// returns on a non-constant-time credential comparison).
export async function getAdminAttendeeByQrTokenHash(input: {
  eventId: string;
  qrTokenHash: string;
}): Promise<WithId<AttendeeDoc> | null> {
  const snap = await attendeeCol()
    .where("eventId", "==", input.eventId)
    .where("qrTokenHash", "==", input.qrTokenHash)
    .limit(1)
    .get();

  if (snap.empty) return null;

  const doc = {
    id: snap.docs[0].id,
    ...(snap.docs[0].data() as AttendeeDoc),
  };
  if (!constantTimeStringEqual(doc.qrTokenHash, input.qrTokenHash)) {
    return null;
  }

  return doc;
}

// Roster list (spec T2): newest first, org-scoped in the query, bounded,
// optional Firestore-side status / checkInState filters (same convention as
// FormData status — filters are pushed to Firestore, never in-memory).
// Search stays client-side over the loaded page (documented limitation).
// Indexes (firestore.indexes.json):
//   base:          Attendee eventId ASC, organizationId ASC, createdAt DESC
//   + status:      Attendee eventId ASC, organizationId ASC, status ASC, createdAt DESC
//   + checkInState: Attendee eventId ASC, organizationId ASC, checkInState ASC, createdAt DESC
// (Both filters at once is NOT a supported list shape in M5 — no index.)
// Cursor = the last row's createdAt millis ("load more").
export async function listAdminAttendeesForEvent(input: {
  eventId: string;
  organizationId: string;
  status?: AttendeeStatus;
  checkInState?: AttendeeCheckInState;
  limit?: number;
  startAfterCreatedAtMs?: number;
}): Promise<WithId<AttendeeDoc>[]> {
  if (input.status !== undefined && input.checkInState !== undefined) {
    throw new Error(
      "[adminAttendee] status and checkInState filters cannot be combined " +
        "(no composite index registered for that shape).",
    );
  }

  let query = attendeeCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId);

  if (input.status !== undefined) {
    query = query.where("status", "==", input.status);
  }
  if (input.checkInState !== undefined) {
    query = query.where("checkInState", "==", input.checkInState);
  }

  let ordered = query.orderBy("createdAt", "desc");
  if (input.startAfterCreatedAtMs !== undefined) {
    ordered = ordered.startAfter(
      Timestamp.fromMillis(input.startAfterCreatedAtMs),
    );
  }

  const snap = await ordered.limit(input.limit ?? ATTENDEE_LIST_LIMIT).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as AttendeeDoc) }));
}

// Stat-card / badge counts (spec T2 AC-2, T4 AC-1) via Firestore AGGREGATE
// count() — never a page-length count and never an unbounded doc read: the
// aggregation is computed server-side from index entries (billed 1 read per
// 1000 entries, no documents transferred), so it stays correct and cheap at
// any roster size. Equality-only filters — served by index merging.
// Usage: accepted total = { status: "accepted" }; checked-in =
// { checkInState: "checked-in" }.
//
// M7-T1 (spec agents/docs/specs/m7-reporting-summaries.md §1/§3): extended
// with an optional `ticketTypeId` filter for the "Registrations by ticket
// type" chart — one call per ticket type (status: "accepted", ticketTypeId:
// <id>), plus one more call with `ticketTypeId: null` for the "No ticket
// type" bucket (Firestore supports equality against `null`; the field is
// distinguished from "not provided" via `!== undefined`, same convention as
// status/checkInState above). The report caller is responsible for the
// Promise.all fan-out across ticket types (≤ TICKET_TYPE_LIST_LIMIT + 1
// calls per §3) — this DAL stays a single-query primitive, not a batcher.
// Still equality-only (eventId, organizationId, status, ticketTypeId): no
// new composite index required (confirmed against a live Firestore emulator
// during Implement — see agents/docs/data-models/m7-reporting-summaries.md).
export async function countAdminAttendeesForEvent(input: {
  eventId: string;
  organizationId: string;
  status?: AttendeeStatus;
  checkInState?: AttendeeCheckInState;
  ticketTypeId?: string | null;
}): Promise<number> {
  let query = attendeeCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId);

  if (input.status !== undefined) {
    query = query.where("status", "==", input.status);
  }
  if (input.checkInState !== undefined) {
    query = query.where("checkInState", "==", input.checkInState);
  }
  if (input.ticketTypeId !== undefined) {
    query = query.where("ticketTypeId", "==", input.ticketTypeId);
  }

  const snap = await query.count().get();
  return snap.data().count;
}

// Workspace dashboard aggregate (M8-T2): accepted registrations across the
// whole organization, regardless of which event owns each attendee. Mirrors
// countAdminAttendeesForEvent without event/check-in/ticket filters.
export async function countAdminAttendeesForOrganization(input: {
  organizationId: string;
  status?: AttendeeStatus;
}): Promise<number> {
  let query = attendeeCol().where("organizationId", "==", input.organizationId);

  if (input.status !== undefined) {
    query = query.where("status", "==", input.status);
  }

  const snap = await query.count().get();
  return snap.data().count;
}

// ============================================================================
// M5-T5 — idempotent check-in flip
// ============================================================================

export interface CheckInAdminAttendeeInput {
  attendeeId: string;
  eventId: string;
  organizationId: string;
  // Scanner identity — {kind:"admin"} from the dashboard scanner,
  // {kind:"team-member"} from the public scanner session.
  checkedInBy: AttendeeCheckedInBy;
}

export type CheckInAdminAttendeeResult =
  // First confirm: the flip was recorded now.
  | { ok: true; alreadyCheckedIn: false; attendee: WithId<AttendeeDoc> }
  // Duplicate confirm: the ORIGINAL record, unchanged — zero writes.
  | {
      ok: true;
      alreadyCheckedIn: true;
      attendee: WithId<AttendeeDoc>;
      checkedInAt: AttendeeDoc["checkedInAt"];
      checkedInBy: AttendeeCheckedInBy | null;
    }
  // NOT_FOUND -> route 404 (missing or cross-org/cross-event — IDOR-safe);
  // CANCELLED -> the scanner's "Registration cancelled" invalid variant.
  | { ok: false; code: "NOT_FOUND" | "CANCELLED"; message: string };

// Transactional, idempotent flip to "checked-in" (spec T5 AC-5/AC-6):
// - read + tenant check (cross-org/event -> NOT_FOUND);
// - status "cancelled" -> CANCELLED, no write;
// - already checked in -> ALREADY with the original checkedInAt/checkedInBy,
//   NO write — the first scanner's record is never overwritten;
// - else write checkInState + checkedInAt (serverTimestamp) + checkedInBy
//   (+ updatedAt). Concurrent confirms serialize inside the transaction:
// exactly one performs the write, the rest observe "checked-in".
export async function checkInAdminAttendee(
  input: CheckInAdminAttendeeInput,
): Promise<CheckInAdminAttendeeResult> {
  const ref = attendeeCol().doc(input.attendeeId);

  return adminDb.runTransaction<CheckInAdminAttendeeResult>(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return { ok: false, code: "NOT_FOUND", message: "Attendee not found." };
    }

    const doc = snap.data() as AttendeeDoc;
    if (
      doc.eventId !== input.eventId ||
      doc.organizationId !== input.organizationId
    ) {
      // Cross-tenant ids are indistinguishable from missing ones.
      return { ok: false, code: "NOT_FOUND", message: "Attendee not found." };
    }

    if (doc.status === "cancelled") {
      return {
        ok: false,
        code: "CANCELLED",
        message: "Registration cancelled.",
      };
    }

    if (doc.checkInState === "checked-in") {
      return {
        ok: true,
        alreadyCheckedIn: true,
        attendee: { id: snap.id, ...doc },
        checkedInAt: doc.checkedInAt,
        checkedInBy: doc.checkedInBy ?? null,
      };
    }

    tx.update(ref, {
      checkInState: "checked-in" satisfies AttendeeCheckInState,
      checkedInAt: FieldValue.serverTimestamp(),
      checkedInBy: input.checkedInBy,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      alreadyCheckedIn: false,
      attendee: {
        id: snap.id,
        ...doc,
        checkInState: "checked-in",
        checkedInAt: FieldValue.serverTimestamp(),
        checkedInBy: input.checkedInBy,
      },
    };
  });
}
