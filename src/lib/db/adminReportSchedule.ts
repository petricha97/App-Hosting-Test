// Server-side data access layer for the ReportSchedule root collection —
// M7-T3's recurring report-delivery config entity. Spec:
// agents/docs/specs/m7-scheduled-reports.md (§2/§4).
//
// SERVER-ONLY: no client repo pair exists and firestore.rules denies all
// client access (organizer-configured recipient list — PII-adjacent config,
// same posture as EmailDefinition/EmailMessage). All reads/writes go through
// server routes gated session -> org -> getAdminEventForOrganization ->
// write:events (Full-Stack's schedule CRUD routes, built on top of this
// module) AND the internal lifecycle sweep (src/lib/email/lifecycle/
// evaluate-report-schedules.ts), which is fail-closed-shared-secret
// authenticated instead (M6-T3 §9 posture, unchanged here).
//
// Doc IDs are DETERMINISTIC: reportScheduleId(organizationId, eventId,
// templateSlug) (src/lib/db/reportScheduleId.ts) — one schedule per
// (event, template) BY CONSTRUCTION (spec §4 OQ-4's deliberate scope call).
// "Editing a schedule" is an upsert onto this same id — matches
// EmailDefinition's own materialize-on-first-edit / create-if-absent shape
// (src/lib/db/adminEmailDefinition.ts).
//
// Recipient model (spec D2 — the ticket's central security decision):
// verified current org members only, NEVER a client-trusted free-text list.
// `verifyReportScheduleRecipient` wraps the already-shipped
// `getAdminUserMembership` (src/lib/db/adminUserOrganization.ts, UNCHANGED
// by this ticket) and is the ONE function both call sites share:
//   - add/edit time (below, inside upsertAdminReportSchedule — every
//     recipient in a write is independently re-verified, so a caller bug in
//     the CRUD route can never persist an unverified recipient; belt-and-
//     suspenders on top of whatever the route itself already checked);
//   - fire time (src/lib/email/lifecycle/evaluate-report-schedules.ts —
//     re-verified fresh immediately before each period's send, a departed
//     member is silently DROPPED from that send only, never an error).
import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { isReportTemplateId } from "@/features/reports/templates";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { getAdminUserMembership } from "@/lib/db/adminUserOrganization";
import { reportScheduleId } from "@/lib/db/reportScheduleId";
import {
  reportScheduleUpsertPatchSchema,
  type ReportScheduleUpsertPatchInput,
} from "@/lib/db/reportScheduleSchemas";
import type {
  ReportScheduleDoc,
  ReportScheduleRecipient,
  WithId,
} from "@/types/collection";

export const REPORT_SCHEDULE_COLLECTION = "ReportSchedule";

// Re-exported for CRUD-route callers (Full-Stack's slice) so the recipient
// cap is checked against the SAME constant this DAL enforces — never a
// second, potentially-drifted copy of "20".
export {
  MAX_RECIPIENTS_PER_SCHEDULE,
  reportScheduleUpsertPatchSchema,
} from "@/lib/db/reportScheduleSchemas";
export type { ReportScheduleUpsertPatchInput } from "@/lib/db/reportScheduleSchemas";

// List bound is generously ABOVE the hard, BY-CONSTRUCTION cap (5 templates
// -> 5 max schedules per event, spec §4) — a genuine Firestore `.limit()`
// (never an unbounded read) that would still return every doc even if that
// invariant were ever violated out-of-band (same defense-in-depth posture
// as EMAIL_DEFINITION_LIST_LIMIT, src/lib/db/adminEmailDefinition.ts).
export const REPORT_SCHEDULE_LIST_LIMIT = 20;

function reportScheduleCol() {
  return adminDb.collection(REPORT_SCHEDULE_COLLECTION);
}

// ============================================================================
// Reads
// ============================================================================

// Single schedule scoped to event + org — null when missing OR when the doc
// belongs to another event/org (callers 404 on null, IDOR-safe, M5
// convention). The tenancy re-check is defense in depth: the deterministic
// id already encodes (organizationId, eventId, templateSlug), so a mismatch
// here would require a sha256 preimage collision — kept anyway for
// consistency with every other admin DAL method in this repo.
export async function getAdminReportScheduleForEvent(input: {
  scheduleId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<ReportScheduleDoc> | null> {
  const snap = await reportScheduleCol().doc(input.scheduleId).get();
  if (!snap.exists) return null;

  const doc = { id: snap.id, ...(snap.data() as ReportScheduleDoc) };
  if (
    doc.organizationId !== input.organizationId ||
    doc.eventId !== input.eventId
  ) {
    return null;
  }

  return doc;
}

// Convenience lookup by the logical key (templateSlug) — computes the
// deterministic id and delegates. Returns null for a template that has no
// MATERIALIZED schedule yet (never configured, or deleted).
export async function getAdminReportScheduleByTemplate(input: {
  templateSlug: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<ReportScheduleDoc> | null> {
  return getAdminReportScheduleForEvent({
    scheduleId: reportScheduleId(input),
    eventId: input.eventId,
    organizationId: input.organizationId,
  });
}

// Lists every materialized schedule for the event — org-scoped IN THE
// QUERY, bounded. No orderBy/cursor (spec §4 gap analysis: "no
// createdAt/cursor ordering needed at this volume, unlike every paginated
// list elsewhere in this codebase") — at most 5 real docs per event by
// construction, display ordering (if any) is the consumer's job over this
// tiny, complete list.
//
// INDEX NOTE (deviation from the spec's own gap-analysis suggestion,
// documented in agents/docs/data-models/m7-scheduled-reports.md): this is a
// pure equality-filter query (eventId ==, organizationId ==) with NO
// orderBy, which Firestore serves from its automatic per-field indexes —
// no composite index entry is required. Confirmed against this codebase's
// own precedent: src/lib/db/adminCheckinTeamMember.ts's `eventId ==` +
// `accessCodeHash ==` + `isActive ==` query (three equality filters, no
// orderBy) has never needed one either. firestore.indexes.json is
// deliberately left unchanged by this ticket.
export async function listAdminReportSchedulesForEvent(input: {
  eventId: string;
  organizationId: string;
}): Promise<WithId<ReportScheduleDoc>[]> {
  const snap = await reportScheduleCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .limit(REPORT_SCHEDULE_LIST_LIMIT)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as ReportScheduleDoc),
  }));
}

// ============================================================================
// Recipient verification (spec D2) — the ONE call site both add-time (via
// upsertAdminReportSchedule below) and fire-time (the evaluator) share.
// ============================================================================

// Resolves a candidate email to the MATCHED member's real name, or null when
// the email is not a current member of the organization (typo, external
// address, ex-member, or a real member of a DIFFERENT org — the two-org
// IDOR-shaped case spec §2 AC-2 names explicitly). Never returns a
// caller-supplied name — the returned `name` always comes from the matched
// User doc itself (spec §2 AC-1).
export async function verifyReportScheduleRecipient(
  candidateEmail: string,
  organizationId: string,
): Promise<ReportScheduleRecipient | null> {
  const email = candidateEmail.trim().toLowerCase();
  if (!email) return null;

  const membership = await getAdminUserMembership(email, organizationId);
  if (!membership) return null;

  // Membership found means a User doc exists at this email (the roster
  // check reads it) — the second lookup here is only for the display name,
  // never re-validates tenancy.
  const user = await getAdminUserByEmail(email);
  if (!user) return null;

  return { email, name: user.name ?? "" };
}

// ============================================================================
// Create-if-absent upsert (deterministic id) — materialize-on-first-create
// AND every subsequent edit, both through ONE entrypoint (spec §4: "editing
// a schedule is an upsert onto this same id").
// ============================================================================

export type UpsertAdminReportScheduleResult =
  | { ok: true; created: boolean; schedule: WithId<ReportScheduleDoc> }
  // VALIDATION: Zod-shape failures (unknown frequency, dayOfMonth out of
  // range, > MAX_RECIPIENTS_PER_SCHEDULE, a dayOfWeek/dayOfMonth mismatched
  // with the chosen frequency) -> route 400s with `issues`, zero write.
  | { ok: false; code: "VALIDATION"; issues: string[] }
  // UNKNOWN_TEMPLATE: templateSlug is not one of the 5 real ReportTemplateId
  // values -> route 400s, zero write.
  | { ok: false; code: "UNKNOWN_TEMPLATE" }
  // NOT_A_MEMBER: one or more recipientEmails failed
  // verifyReportScheduleRecipient (spec §2 AC-2) -> route 400s naming the
  // offending emails, ALL-OR-NOTHING — zero write, matching
  // sendEventEmailBatch's own "invalid recipients" all-or-nothing
  // convention (src/lib/email/send-service.ts).
  | { ok: false; code: "NOT_A_MEMBER"; emails: string[] }
  // NOT_FOUND: cross-org/cross-event id collision (defense in depth, see
  // getAdminReportScheduleForEvent) -> route 404-IDOR, zero writes.
  | { ok: false; code: "NOT_FOUND" };

export async function upsertAdminReportSchedule(input: {
  organizationId: string;
  eventId: string;
  templateSlug: string;
  // Creator's email — stamped ONLY on first create (audit-only, immutable
  // thereafter; a later edit by a different write:events holder never
  // rewrites who originally configured the schedule).
  createdBy: string;
  // Raw, UNTRUSTED request-body shape — parsed HERE (defense in depth,
  // never trust an already-"typed" caller alone), matching
  // adminEmailDefinition.ts's upsertAdminEmailDefinition precedent.
  patch: unknown;
}): Promise<UpsertAdminReportScheduleResult> {
  if (!isReportTemplateId(input.templateSlug)) {
    return { ok: false, code: "UNKNOWN_TEMPLATE" };
  }

  const parsedPatch = reportScheduleUpsertPatchSchema.safeParse(input.patch);
  if (!parsedPatch.success) {
    return {
      ok: false,
      code: "VALIDATION",
      issues: parsedPatch.error.issues.map((issue) => issue.message),
    };
  }
  const patch: ReportScheduleUpsertPatchInput = parsedPatch.data;

  // Recipient re-verification happens OUTSIDE the transaction — these are
  // reads against the UNRELATED `User` collection, not ReportSchedule's own
  // doc, so there is nothing to gain from nesting them inside the
  // transactional read-write below. A narrow, non-atomic window where a
  // recipient could leave the org between this check and the write commit
  // is accepted (self-healing: the evaluator independently RE-verifies
  // every recipient again at every fire, spec D2's actual durability
  // guarantee — this write-time check exists to satisfy spec §2 AC-2's
  // "zero write" contract, not to be the ONLY membership check ever run).
  const resolved = await Promise.all(
    patch.recipientEmails.map(async (email) => ({
      email,
      match: await verifyReportScheduleRecipient(email, input.organizationId),
    })),
  );
  const notMembers = resolved
    .filter((entry) => entry.match === null)
    .map((entry) => entry.email);
  if (notMembers.length > 0) {
    return { ok: false, code: "NOT_A_MEMBER", emails: notMembers };
  }
  const recipients: ReportScheduleRecipient[] = resolved.map(
    (entry) => entry.match as ReportScheduleRecipient,
  );

  const scheduleId = reportScheduleId({
    organizationId: input.organizationId,
    eventId: input.eventId,
    templateSlug: input.templateSlug,
  });
  const ref = reportScheduleCol().doc(scheduleId);

  return adminDb.runTransaction<UpsertAdminReportScheduleResult>(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as ReportScheduleDoc) : null;

    if (
      existing &&
      (existing.organizationId !== input.organizationId ||
        existing.eventId !== input.eventId)
    ) {
      return { ok: false, code: "NOT_FOUND" };
    }

    const shared: Pick<
      ReportScheduleDoc,
      | "frequency"
      | "dayOfWeek"
      | "dayOfMonth"
      | "hour"
      | "minute"
      | "recipients"
      | "enabled"
    > = {
      frequency: patch.frequency,
      dayOfWeek: patch.dayOfWeek,
      dayOfMonth: patch.dayOfMonth,
      hour: patch.hour,
      minute: patch.minute,
      recipients,
      enabled: patch.enabled,
    };

    if (!existing) {
      const doc: ReportScheduleDoc = {
        organizationId: input.organizationId,
        eventId: input.eventId,
        templateSlug: input.templateSlug,
        ...shared,
        createdBy: input.createdBy,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      // tx.create backstops the read-write race: a genuinely concurrent
      // creator for the SAME (event, template) aborts and retries,
      // landing in the `existing` branch above on replay
      // (create-if-absent, M6-T1 pattern) — exactly one doc, ever.
      tx.create(ref, doc);
      return {
        ok: true,
        created: true,
        schedule: { id: scheduleId, ...doc },
      };
    }

    const updatePatch: Partial<ReportScheduleDoc> = {
      ...shared,
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.update(ref, updatePatch);
    return {
      ok: true,
      created: false,
      schedule: { id: scheduleId, ...existing, ...updatePatch },
    };
  });
}

// ============================================================================
// Delete (hard delete — no soft-delete/archive concept, spec §4)
// ============================================================================

export type DeleteAdminReportScheduleResult =
  | { ok: true }
  // NOT_FOUND doubles as the cross-org/cross-event answer (IDOR-safe, M5
  // convention).
  | { ok: false; code: "NOT_FOUND" };

// Non-transactional get-then-delete (adminEmailDefinition.ts /
// adminCheckinTeamMember.ts precedent) — a double-delete race just answers
// NOT_FOUND on the second call, no corruption possible. Deleting a schedule
// NEVER touches EmailMessage: historical outbox rows for
// `scheduled-report:<slug>` keep their `kind`/`dedupeKey` and remain
// queryable in the Email overview report (spec §5 AC-2, audit retention) —
// this function only ever issues a single delete against the ReportSchedule
// collection.
export async function deleteAdminReportSchedule(input: {
  scheduleId: string;
  eventId: string;
  organizationId: string;
}): Promise<DeleteAdminReportScheduleResult> {
  const existing = await getAdminReportScheduleForEvent(input);
  if (!existing) return { ok: false, code: "NOT_FOUND" };

  await reportScheduleCol().doc(input.scheduleId).delete();
  return { ok: true };
}
