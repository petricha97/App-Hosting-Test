// Server-side data access layer for the EmailDefinition root collection —
// the per-event lifecycle-email template entity. Spec:
// agents/docs/specs/m6-emails-admin.md (§2).
//
// SERVER-ONLY: no client repo pair exists and firestore.rules denies all
// client access (recipient-facing template content + org data). All
// reads/writes go through server routes gated session -> org ->
// getAdminEventForOrganization -> write:events (T2's API routes, built by
// the Full-Stack Developer on top of this module).
//
// Doc IDs are DETERMINISTIC: emailDefinitionId(organizationId, eventId, kind)
// (src/lib/db/emailDefinitionId.ts) — `kind` is unique per event BY
// CONSTRUCTION, and creating a doc for a given kind is always a
// create-if-absent upsert at a predictable id (no separate existence lookup
// needed before writing).
//
// VIRTUAL DEFAULTS (Shared decision, spec top): the eight default lifecycle
// emails are defined in code (Full-Stack slice: default-definitions.ts) and
// are NEVER seeded here. A fresh event has ZERO EmailDefinition docs. A doc
// is materialized only on first edit — `upsertAdminEmailDefinition` is that
// single materialize-or-update entrypoint, matching the create-if-absent
// shape of adminEmailMessage.ts's `createAdminEmailMessageIfAbsent`.
//
// Editability (spec §2, enforced HERE, never client-only):
//   - isSystem:true  -> name/group/trigger.type/audience are LOCKED; only
//     subject/body/enabled/(scheduled) trigger.at may change.
//   - isSystem:false (custom) -> all fields editable, but trigger.type is
//     restricted to "manual" | "scheduled" (OQ-1 default, re-checked here
//     even though the create-custom Zod schema also enforces it).
// Locked-field violations return a typed LOCKED_FIELDS result (field names),
// never a silent partial-apply.
import "server-only";

import { randomUUID } from "node:crypto";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { emailDefinitionId } from "@/lib/db/emailDefinitionId";
import {
  CUSTOM_EMAIL_DEFINITION_ALLOWED_TRIGGER_TYPES,
  emailDefinitionEditablePatchSchema,
  emailDefinitionIfAbsentSchema,
  type EmailDefinitionEditablePatchInput,
  type EmailDefinitionIfAbsentInput,
  type EmailDefinitionTriggerInput,
} from "@/lib/email/schemas";
import type {
  EmailDefinitionDoc,
  EmailDefinitionTrigger,
  WithId,
} from "@/types/collection";

export const EMAIL_DEFINITION_COLLECTION = "EmailDefinition";

// Spec §2: "hard cap 100 definitions per event enforced at create". The
// eight system defaults + a generous allowance of custom definitions — a
// deliberately small ceiling that keeps the list unquestionably bounded
// without pagination (spec: "list is small and bounded").
export const MAX_EMAIL_DEFINITIONS_PER_EVENT = 100;

// List bound is intentionally ABOVE the enforced create-time cap (defense in
// depth: even if the cap were ever violated out-of-band, the list still
// returns every doc, never a silently-truncated page) while remaining a
// genuine Firestore `.limit()` — never an unbounded read.
export const EMAIL_DEFINITION_LIST_LIMIT = 200;

// Fields locked on isSystem:true docs (spec §2) — checked against the
// PATCH, never the ifAbsent/create shape (the catalog's own values are
// trusted, code-authored input).
const SYSTEM_LOCKED_SCALAR_FIELDS = ["name", "group", "audience"] as const;

function emailDefinitionCol() {
  return adminDb.collection(EMAIL_DEFINITION_COLLECTION);
}

// Server-mints a custom definition's kind — NEVER accepted from client
// input (spec §2 AC-2). The "custom-" prefix is the one place both the
// virtual-vs-stored merge (Full-Stack) and any future kind-based branching
// can rely on to distinguish custom definitions from catalog kinds.
export function mintCustomEmailDefinitionKind(): string {
  return `custom-${randomUUID()}`;
}

function toStoredTrigger(
  trigger: EmailDefinitionTriggerInput,
): EmailDefinitionTrigger {
  if (trigger.type !== "scheduled") return trigger;
  return {
    type: "scheduled",
    at: trigger.at === null ? null : Timestamp.fromDate(trigger.at),
  };
}

// ============================================================================
// Reads
// ============================================================================

// Single definition scoped to event + org — null when missing OR when the
// doc belongs to another event/org (callers 404 on null, IDOR-safe, M5
// convention). The tenancy re-check is defense in depth: the deterministic
// id already encodes (organizationId, eventId, kind), so a mismatch here
// would require a sha256 preimage collision — kept anyway for consistency
// with every other admin DAL method in this repo (T1 precedent).
export async function getAdminEmailDefinitionForEvent(input: {
  definitionId: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<EmailDefinitionDoc> | null> {
  const snap = await emailDefinitionCol().doc(input.definitionId).get();
  if (!snap.exists) return null;

  const doc = { id: snap.id, ...(snap.data() as EmailDefinitionDoc) };
  if (
    doc.organizationId !== input.organizationId ||
    doc.eventId !== input.eventId
  ) {
    return null;
  }

  return doc;
}

// Convenience lookup by the logical key (kind) — computes the deterministic
// id and delegates. Returns null for a kind that has no MATERIALIZED doc
// yet (a virtual default with no edits) — callers merge with the in-code
// catalog (Full-Stack's default-definitions.ts) to render the full list.
export async function getAdminEmailDefinitionByKind(input: {
  kind: string;
  eventId: string;
  organizationId: string;
}): Promise<WithId<EmailDefinitionDoc> | null> {
  return getAdminEmailDefinitionForEvent({
    definitionId: emailDefinitionId(input),
    eventId: input.eventId,
    organizationId: input.organizationId,
  });
}

// Lists ONLY materialized (stored) definitions for the event — org-scoped
// IN THE QUERY, bounded, oldest-first. Served by the composite index
// (firestore.indexes.json): EmailDefinition eventId ASC, organizationId ASC,
// createdAt ASC. `sortOrder` is NOT part of the index/orderBy (spec §2) —
// display ordering (sortOrder then createdAt, defaults-before-customs) is
// the consumer's job over this bounded page, same division of labor as the
// M1 TicketType list.
export async function listAdminEmailDefinitionsForEvent(input: {
  eventId: string;
  organizationId: string;
}): Promise<WithId<EmailDefinitionDoc>[]> {
  const snap = await emailDefinitionCol()
    .where("eventId", "==", input.eventId)
    .where("organizationId", "==", input.organizationId)
    .orderBy("createdAt", "asc")
    .limit(EMAIL_DEFINITION_LIST_LIMIT)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as EmailDefinitionDoc),
  }));
}

// ============================================================================
// Create-if-absent upsert (deterministic id) — materialize-on-first-edit AND
// subsequent edits, both system and custom, through ONE entrypoint.
// ============================================================================

export type UpsertAdminEmailDefinitionResult =
  | { ok: true; created: boolean; definition: WithId<EmailDefinitionDoc> }
  // VALIDATION: Zod-shape failures (unknown enum values, size bounds,
  // non-manual/scheduled custom trigger) -> route 400s with `issues`.
  | { ok: false; code: "VALIDATION"; issues: string[] }
  // LOCKED_FIELDS: the patch touches a field locked on this isSystem:true
  // doc (spec §2) -> route 400s naming the offending fields, zero writes.
  | { ok: false; code: "LOCKED_FIELDS"; fields: string[] }
  // CAP_REACHED: the event already has MAX_EMAIL_DEFINITIONS_PER_EVENT
  // materialized docs -> route 409s, zero writes. Only reachable when
  // creating (existing docs can always still be edited).
  | { ok: false; code: "CAP_REACHED" }
  // NOT_FOUND: cross-org/cross-event id collision (defense in depth, see
  // getAdminEmailDefinitionForEvent) -> route 404-IDOR, zero writes.
  | { ok: false; code: "NOT_FOUND" };

export async function upsertAdminEmailDefinition(input: {
  organizationId: string;
  eventId: string;
  kind: string;
  // isSystem is TRUSTED FROM THE CALLER only for the very first write of a
  // brand-new doc (there is nothing stored yet to derive it from). Once a
  // doc exists, its OWN stored `isSystem` always wins for lock enforcement
  // — a caller cannot bypass system-field locks by passing isSystem:false
  // for an id that already resolves to a system definition.
  isSystem: boolean;
  ifAbsent: EmailDefinitionIfAbsentInput;
  patch: EmailDefinitionEditablePatchInput;
}): Promise<UpsertAdminEmailDefinitionResult> {
  const parsedIfAbsent = emailDefinitionIfAbsentSchema.safeParse(
    input.ifAbsent,
  );
  if (!parsedIfAbsent.success) {
    return {
      ok: false,
      code: "VALIDATION",
      issues: parsedIfAbsent.error.issues.map((issue) => issue.message),
    };
  }

  const parsedPatch = emailDefinitionEditablePatchSchema.safeParse(input.patch);
  if (!parsedPatch.success) {
    return {
      ok: false,
      code: "VALIDATION",
      issues: parsedPatch.error.issues.map((issue) => issue.message),
    };
  }

  const definitionId = emailDefinitionId({
    organizationId: input.organizationId,
    eventId: input.eventId,
    kind: input.kind,
  });
  const ref = emailDefinitionCol().doc(definitionId);

  return adminDb.runTransaction<UpsertAdminEmailDefinitionResult>(
    async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? (snap.data() as EmailDefinitionDoc) : null;

      if (
        existing &&
        (existing.organizationId !== input.organizationId ||
          existing.eventId !== input.eventId)
      ) {
        return { ok: false, code: "NOT_FOUND" };
      }

      // Existing doc's stored flag wins once materialized (see isSystem
      // doc-comment above); otherwise this is the doc's first write.
      const effectiveIsSystem = existing ? existing.isSystem : input.isSystem;
      const priorTriggerType = existing
        ? existing.trigger.type
        : parsedIfAbsent.data.trigger.type;

      const lockedFields: string[] = [];
      if (effectiveIsSystem) {
        for (const field of SYSTEM_LOCKED_SCALAR_FIELDS) {
          if (parsedPatch.data[field] !== undefined) {
            lockedFields.push(field);
          }
        }
        if (
          parsedPatch.data.trigger !== undefined &&
          parsedPatch.data.trigger.type !== priorTriggerType
        ) {
          lockedFields.push("trigger");
        }
      }
      if (lockedFields.length > 0) {
        return { ok: false, code: "LOCKED_FIELDS", fields: lockedFields };
      }

      if (!effectiveIsSystem) {
        const finalTriggerType =
          parsedPatch.data.trigger?.type ?? priorTriggerType;
        if (
          !(
            CUSTOM_EMAIL_DEFINITION_ALLOWED_TRIGGER_TYPES as readonly string[]
          ).includes(finalTriggerType)
        ) {
          return {
            ok: false,
            code: "VALIDATION",
            issues: [
              "Custom emails may only use a Manual or Scheduled trigger.",
            ],
          };
        }
      }

      if (!existing) {
        // Cap check happens INSIDE the transaction, alongside the doc read,
        // so a burst of concurrent creates against the same event is
        // serialized by Firestore's transaction contention detection rather
        // than racing a check performed before the transaction opened.
        const countSnap = await tx.get(
          emailDefinitionCol()
            .where("eventId", "==", input.eventId)
            .where("organizationId", "==", input.organizationId),
        );
        if (countSnap.docs.length >= MAX_EMAIL_DEFINITIONS_PER_EVENT) {
          return { ok: false, code: "CAP_REACHED" };
        }

        const doc: EmailDefinitionDoc = {
          organizationId: input.organizationId,
          eventId: input.eventId,
          kind: input.kind,
          name: parsedPatch.data.name ?? parsedIfAbsent.data.name,
          group: parsedPatch.data.group ?? parsedIfAbsent.data.group,
          trigger: toStoredTrigger(
            parsedPatch.data.trigger ?? parsedIfAbsent.data.trigger,
          ),
          audience: parsedPatch.data.audience ?? parsedIfAbsent.data.audience,
          enabled: parsedPatch.data.enabled ?? parsedIfAbsent.data.enabled,
          subject: parsedPatch.data.subject ?? parsedIfAbsent.data.subject,
          body: parsedPatch.data.body ?? parsedIfAbsent.data.body,
          isSystem: input.isSystem,
          sortOrder: parsedIfAbsent.data.sortOrder,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        // tx.create backstops the read-write race: a genuinely concurrent
        // creator for the SAME kind aborts and retries, landing in the
        // `existing` branch above on replay (create-if-absent, M6-T1
        // pattern) — exactly one doc, ever.
        tx.create(ref, doc);

        return {
          ok: true,
          created: true,
          definition: { id: definitionId, ...doc },
        };
      }

      const updatePatch: Partial<EmailDefinitionDoc> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (parsedPatch.data.name !== undefined) {
        updatePatch.name = parsedPatch.data.name;
      }
      if (parsedPatch.data.group !== undefined) {
        updatePatch.group = parsedPatch.data.group;
      }
      if (parsedPatch.data.trigger !== undefined) {
        updatePatch.trigger = toStoredTrigger(parsedPatch.data.trigger);
      }
      if (parsedPatch.data.audience !== undefined) {
        updatePatch.audience = parsedPatch.data.audience;
      }
      if (parsedPatch.data.enabled !== undefined) {
        updatePatch.enabled = parsedPatch.data.enabled;
      }
      if (parsedPatch.data.subject !== undefined) {
        updatePatch.subject = parsedPatch.data.subject;
      }
      if (parsedPatch.data.body !== undefined) {
        updatePatch.body = parsedPatch.data.body;
      }

      tx.update(ref, updatePatch);

      return {
        ok: true,
        created: false,
        definition: { id: definitionId, ...existing, ...updatePatch },
      };
    },
  );
}

// ============================================================================
// Delete (custom definitions only — system defaults are never deletable)
// ============================================================================

export type DeleteAdminEmailDefinitionResult =
  | { ok: true }
  // NOT_FOUND doubles as the cross-org/cross-event answer (IDOR-safe, M5
  // convention). SYSTEM_LOCKED: the doc is isSystem:true — zero writes,
  // route surfaces a typed rejection (spec §2: "system defaults are not
  // deletable").
  | { ok: false; code: "NOT_FOUND" | "SYSTEM_LOCKED" };

// Non-transactional get-then-delete (adminCheckinTeamMember.ts /
// adminRegistrationPath.ts precedent) — a double-delete race just answers
// NOT_FOUND on the second call, no corruption possible. Deleting a
// definition NEVER touches EmailMessage: historical outbox rows keep their
// `kind`/`definitionId` and render the raw kind once the definition is gone
// (spec §2 AC-6, audit retention) — this function only ever issues a single
// delete against the EmailDefinition collection.
export async function deleteAdminEmailDefinition(input: {
  definitionId: string;
  eventId: string;
  organizationId: string;
}): Promise<DeleteAdminEmailDefinitionResult> {
  const existing = await getAdminEmailDefinitionForEvent(input);
  if (!existing) return { ok: false, code: "NOT_FOUND" };

  if (existing.isSystem) {
    return { ok: false, code: "SYSTEM_LOCKED" };
  }

  await emailDefinitionCol().doc(input.definitionId).delete();
  return { ok: true };
}
