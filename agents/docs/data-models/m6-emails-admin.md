# M6-T2 Data Model — `EmailDefinition` (Lifecycle Email Templates)

Backend Agent, 2026-07-14. Implements the DAL slice of `agents/docs/specs/m6-emails-admin.md` (M6-T2 §2) under `baseline.md` / `m1`–`m6-email-infrastructure.md` conventions. Source of truth: `src/types/collection.ts` (`EmailDefinitionDoc` + `EmailDefinitionTrigger`/`Group`/`Audience`) + `src/lib/db/{adminEmailDefinition,emailDefinitionId}.ts` + `src/lib/email/schemas.ts` (EmailDefinition section) + `firestore.indexes.json` + `firestore.rules`. **This slice ships NO API route, NO UI, and NO default-catalog data** (`src/features/emails/*`, including the in-code virtual catalog `default-definitions.ts`, is the Full-Stack Developer's slice built on top of this DAL).

## Collection

### `EmailDefinition` (root, **deterministic doc IDs**, SERVER-ONLY — recipient-facing template content + org data)

Doc id = `emailDefinitionId(organizationId, eventId, kind)` = `sha256(JSON(["EmailDefinition", organizationId, eventId, kind]))` (`src/lib/db/emailDefinitionId.ts`, pure — same tuple-hash family as `emailMessageId.ts` / `formDataId.ts` / `attendeeId.ts` / `order-id.ts`, `"EmailDefinition"` domain prefix keeps derivations disjoint). `kind` is therefore **unique per event by construction** — two definitions with the same kind in the same event collapse onto one doc, and `EmailMessage.definitionId` (T1) is this same computed hash whether or not the doc actually exists.

```ts
interface EmailDefinitionDoc {
  organizationId; eventId: string;
  kind: string;                          // join key; doc id is derived from it
  name: string;                          // <=120
  group: "pre-event" | "post-registration" | "debt-chase";
  trigger:
    | { type: "manual" }
    | { type: "on-submit" }
    | { type: "on-accept" }
    | { type: "abandoned-24h" }
    | { type: "unpaid-offsets"; offsetsDays: number[] }   // positive ints, >=1 entry
    | { type: "scheduled"; at: Timestamp | null };        // null = "Not scheduled"
  audience: "all-invitees" | "abandoned" | "pending-approval"
          | "accepted-paid" | "accepted-invoice" | "accepted-all";
  enabled: boolean;
  subject: string;                       // TEMPLATE, <=255 chars
  body: string;                          // TEMPLATE, plain text + {merge_tags}, <=32 KB
  isSystem: boolean;
  sortOrder: number;                     // display tiebreak, NOT indexed
  createdAt / updatedAt;
}
```

**`bodyHtml`/`bodyText` are never stored here** — they are *derived* at preview/send time (Full-Stack `src/features/emails/server/*`, T2 scope decision: HTML-escape + paragraph wrapping, no raw HTML until the M6-T4 designer). `EmailDefinition.body` is always the plain-text template.

## Virtual defaults — nothing is seeded

The eight default lifecycle emails (spec §2 catalog: `invitation`, `abandoned-reminder`, `approval-pending`, `confirmation-paid`, `confirmation-payment-due`, `payment-reminder`, `one-week-to-go`, `qr-ready`) are **defined in code** (Full-Stack's `src/features/emails/default-definitions.ts`), never written to Firestore by this DAL. A fresh event therefore has **zero** `EmailDefinition` docs — rendering the list is a pure read-time merge of the virtual catalog with whatever this DAL's `listAdminEmailDefinitionsForEvent` returns, keyed by `kind`. **Stored docs always win** over the virtual defaults in that merge.

A doc is **materialized** — created at the deterministic id — only on the definition's first edit (toggle, subject/body, or scheduled datetime change), via `upsertAdminEmailDefinition`. This mirrors the `CheckinConfig` / `EmailSettings` "lazy doc, read-time default" pattern already established in M5/M6-T1, and means the DAL never needs a seed/migration step for new or existing events.

## Editability (spec §2, enforced in the DAL — never client-only)

| | `isSystem:true` | `isSystem:false` (custom) |
|---|---|---|
| `name`, `group`, `audience` | **locked** | editable |
| `trigger.type` | **locked** (only `trigger.at` may change, and only for a `scheduled` kind) | editable, but restricted to `"manual" \| "scheduled"` (OQ-1 default) |
| `subject`, `body`, `enabled` | editable | editable |
| `kind` | never in the patch shape (immutable, IS the doc-id partition) | server-minted only, never in the patch shape |

`upsertAdminEmailDefinition` computes `effectiveIsSystem` from the **stored** doc's `isSystem` once one exists (never trusts a caller-supplied `isSystem` to override an existing doc — closes a bypass where a caller could pass `isSystem:false` against an id that already resolves to a system definition). Any patch key that is locked for the effective `isSystem` returns a typed `LOCKED_FIELDS` result naming the offending fields — a 400 with field errors at the route layer, zero writes either way. The trigger-type restriction for custom definitions is re-checked here too (defense in depth beyond the create-custom Zod schema), matching T1's "re-check at send" precedent for `EmailSettings`.

## `upsertAdminEmailDefinition` — one entrypoint, two call shapes

```
upsertAdminEmailDefinition({
  organizationId, eventId, kind, isSystem,
  ifAbsent: { name, group, trigger, audience, enabled, subject, body, sortOrder },
  patch: { name?, group?, trigger?, audience?, enabled?, subject?, body? },
}) -> { ok:true; created:boolean; definition } | VALIDATION | LOCKED_FIELDS | CAP_REACHED | NOT_FOUND
```

- **Materialize a system default's first edit**: `kind` = the catalog kind, `isSystem:true`, `ifAbsent` = the code catalog's fixed shape (trusted, code-authored — not user input), `patch` = the organizer's edit (subject/body/enabled/trigger.at subset).
- **Create a brand-new custom definition**: `kind` = `mintCustomEmailDefinitionKind()` (server-minted `"custom-" + uuid`, guaranteed absent), `isSystem:false`, `ifAbsent` = the create-form values, `patch` = `{}`.
- **Any subsequent edit** (system or custom): same call shape; the doc already exists so `ifAbsent` is ignored except as the reference point for "what was the prior trigger type" when the doc is *simultaneously* being materialized and edited in one call.

**Create-if-absent race safety (M6-T1 pattern):** the whole operation — existence check, tenancy re-check, lock check, cap check, and the write — runs inside one `runTransaction`. `tx.create` backstops the read-write race exactly like `createAdminEmailMessageIfAbsent`: a genuinely concurrent second writer for the same kind is retried by the Firestore client and observes the winner's doc on replay, landing in the update branch. Tests exercise this via sequential replay (same convention as `admin-email-message.test.ts`, since the in-memory test fake does not model automatic transaction retry).

**100-per-event cap (spec §2):** `MAX_EMAIL_DEFINITIONS_PER_EVENT = 100`, enforced **only when creating** a new doc — a `tx.get` count query (`eventId ==`, `organizationId ==`, equality-only, no extra index needed — index merging, same posture as T1's `countAdminEmailMessagesForEvent`) runs inside the same transaction as the create, before `tx.create`. Editing an existing doc never re-checks the cap.

## Reads

- `getAdminEmailDefinitionForEvent({ definitionId, eventId, organizationId })` — doc-id get, org/event re-checked, `null` on missing OR cross-tenant (IDOR-safe).
- `getAdminEmailDefinitionByKind({ kind, eventId, organizationId })` — computes the deterministic id and delegates; `null` for a kind with no materialized doc (a still-virtual default) — callers merge against the in-code catalog.
- `listAdminEmailDefinitionsForEvent({ eventId, organizationId })` — org-scoped in the query, bounded (`EMAIL_DEFINITION_LIST_LIMIT = 200`, deliberately above the 100 create-time cap as a defense-in-depth safety net, never an unbounded read), ordered `createdAt ASC`. `sortOrder` is **not** part of the query/index — display ordering (`sortOrder` then `createdAt`, defaults rendered before customs within a group) is the Full-Stack consumer's job over this bounded page, matching the division of labor already used for `TicketType`.

## Delete — custom only

`deleteAdminEmailDefinition({ definitionId, eventId, organizationId })` is a **non-transactional get-then-delete** (`adminCheckinTeamMember.ts` / `adminRegistrationPath.ts` precedent — a double-delete race just answers `NOT_FOUND` on the second call, no corruption possible):

```
NOT_FOUND      — missing OR cross-org/cross-event (IDOR-safe, zero writes)
SYSTEM_LOCKED  — isSystem:true (system defaults are never deletable, zero writes)
ok:true        — deleted
```

Deleting a custom definition **never touches `EmailMessage`**: only the `EmailDefinition` doc is removed. Historical outbox rows keep their `kind`/`definitionId` verbatim — the Full-Stack log UI resolves a definition name from `kind` and falls back to the raw kind chip when the definition is gone (spec §2 AC-6, §8-4, audit retention — same "frozen snapshot never rewritten" posture as T1's `EmailMessage`).

## Zod schemas (`src/lib/email/schemas.ts`)

Colocated in `src/lib/email/schemas.ts` — **not** `src/features/emails/*` — for the same reason T1's `emailSenderIdentitySchema`/`emailRecipientSchema` live there: `EmailDefinition` is server-only infrastructure with no client repo pair, and `src/features/emails/` is the Full-Stack Developer's slice built on top of this DAL (this Backend Agent slice does not create files under it, per the M6-T2 ticket boundary).

| Schema | Shape | Notes |
|---|---|---|
| `emailDefinitionGroupSchema` | enum | `pre-event \| post-registration \| debt-chase` |
| `emailDefinitionAudienceSchema` | enum | the 6 audiences (§2 table) |
| `emailDefinitionTriggerSchema` | discriminated union on `type` | `scheduled.at` is a plain `Date \| null`, **not** a Firestore `Timestamp` — routes must not import `firebase-admin` directly (`adminTicketType.ts` `SalesBoundaryInput` precedent); `unpaid-offsets.offsetsDays` is `number[]` of positive ints, min 1 entry |
| `CUSTOM_EMAIL_DEFINITION_ALLOWED_TRIGGER_TYPES` | `["manual", "scheduled"]` | OQ-1 default — re-checked in the DAL, not just here |
| `emailDefinitionNameSchema` | string | control-chars stripped + trimmed, 1–120 |
| `emailDefinitionSubjectSchema` | string | ≤255, **no min** (templates may be blank while drafting) |
| `emailDefinitionBodySchema` | string | ≤32 KB (`Buffer.byteLength`, UTF-8) — bound chosen so the worst-case escaped/wrapped derived `bodyHtml` stays under T1's 256 KB rendered cap |
| `emailDefinitionEditablePatchSchema` | all-optional object | `upsertAdminEmailDefinition`'s `patch` — every field optional, DAL enforces which keys are reachable per `isSystem` |
| `emailDefinitionIfAbsentSchema` | required object (no `kind`) | `upsertAdminEmailDefinition`'s `ifAbsent` — backs BOTH system-materialize (any trigger type, catalog-trusted) and custom-create (DAL re-checks the manual/scheduled restriction) |
| `emailDefinitionCreateCustomSchema` | required object (no `kind`) | full shape for a Full-Stack "+ Create email" route; trigger refined to manual/scheduled at the Zod layer too |

`kind` is **never** a field on any of these schemas — it is either the catalog's fixed value (system) or `mintCustomEmailDefinitionKind()`'s output (custom, `"custom-" + randomUUID()`), so a user-supplied `kind` on create has no shape to land in (spec §2 AC-2), independent of whatever the route's own request-body schema also strips.

## Query patterns and indexes

| Query | Method | Index |
|---|---|---|
| List: `eventId == organizationId == ORDER BY createdAt ASC LIMIT 200` | `listAdminEmailDefinitionsForEvent` | composite (below) |
| Cap check: `eventId == organizationId ==` (equality-only, inside the upsert transaction) | `upsertAdminEmailDefinition` | none needed — index merging, same posture as T1's aggregate count |
| Get by id / by kind | doc id (deterministic) | n/a (doc get) |

Registered in `firestore.indexes.json` this change:

1. `EmailDefinition`: `eventId ASC, organizationId ASC, createdAt ASC` (spec §2's exact index — `sortOrder` deliberately excluded, see Reads above)

## Read/write access rules

`firestore.rules`: explicit **deny-all** added for `EmailDefinition`, alongside the existing `EmailMessage`/`EmailSettings` M6 block (§2 spec AC / firestore.rules deny-all requirement). No client repo pair exists — server-only by construction. All reads/writes go through Full-Stack's T2 API routes, which gate session → org → `getAdminEventForOrganization` → `write:events` before calling this DAL (M1–M5 convention, unchanged).

## Divergences / notes for the Full-Stack slice

- **`ifAbsent` must be supplied on every edit call, not just the first one.** Because `upsertAdminEmailDefinition` doesn't know in advance whether a doc exists, callers editing an *already-materialized* system default still pass the catalog's `ifAbsent` shape (harmlessly ignored once `existing` is found) — the route/service layer should source it from `default-definitions.ts` unconditionally rather than trying to special-case "doc already exists."
- **`sortOrder`** is stored but not queried/ordered by the DAL — the list/merge UI owns `sortOrder`-then-`createdAt` tiebreaking (spec §1: "Custom definitions render in their chosen group beneath the defaults, ordered by sortOrder then createdAt").
- **Test-send / trigger evaluation / audience query evaluation are NOT part of this DAL** — `enabled:false` refusal for test-send (spec §2 AC-5) and all T3 trigger-firing logic live in the Full-Stack / M6-T3 layers and must read `EmailDefinitionDoc.enabled` themselves; this DAL only stores and returns it.
- **No `EmailDefinition` reads join `EmailMessage`** in this slice — the Full-Stack per-definition history view (§5) filters `listAdminEmailMessagesForEvent` by `kind` (T1, unchanged) entirely client-side of this DAL.
