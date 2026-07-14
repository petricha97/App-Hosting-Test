# M6 Data Model — Email Infrastructure (Outbox, Sender Identity, Transport, Merge Tags)

Backend + Full-Stack Agent, 2026-07-13. Implements the data layer of `agents/docs/specs/m6-email-infrastructure.md` (M6-T1) under `baseline.md` / `m1`–`m5` conventions. Source of truth: `src/types/collection.ts` + `src/lib/db/{adminEmailMessage,adminEmailSettings,emailMessageId}.ts` + `src/lib/email/{transport,dev-outbox-transport,send-service,sender-identity,merge-tags,merge-context,schemas}.ts` + `firestore.indexes.json` + `firestore.rules`. **T1 ships NO API route and NO UI** — the emails screen (T2), triggers/scheduling (T3) and the designer (T4) sit on this substrate.

## Collections

### `EmailMessage` (root, **deterministic doc IDs**, SERVER-ONLY — recipient PII + rendered bodies)

Doc id = `emailMessageId(org, event, kind, recipientEmailLower, dedupeKey)` = `sha256(JSON(["EmailMessage", organizationId, eventId, kind, recipientEmail.toLowerCase(), dedupeKey]))` (`src/lib/db/emailMessageId.ts`, pure — same tuple-hash family as `formDataId.ts` / `attendeeId.ts` / `order-id.ts`, "EmailMessage" domain prefix keeps derivations disjoint).

```ts
interface EmailMessageDoc {
  organizationId; eventId: string;
  definitionId: string | null;          // null until T2 ships EmailDefinition
  kind: string;                         // free-text join key ("confirmation-paid", "manual", …)
  dedupeKey: string;                    // caller-supplied per LOGICAL send (id-bearing)
  recipient: { name: string; email: string };  // email stored lowercased
  attendeeId: string | null;  submissionId: string | null;
  from: { name: string; address: string };     // resolved sender SNAPSHOT (never merge-rendered)
  replyTo: string | null;
  subject / bodyHtml / bodyText: string;        // RENDERED snapshot, frozen at enqueue
  status: "queued" | "sent" | "failed";
  attemptCount: number;                 // COMPLETED transport attempts
  lastError: { message: string; at: Timestamp } | null;  // truncated ≤ 500 chars, single-line
  providerMessageId: string | null;     // "dev-" + messageId under the dev transport
  provider: "dev-outbox";
  queuedAt; sentAt: Timestamp | null; failedAt: Timestamp | null;
  createdAt / updatedAt;
}
```

**Never double-send by construction:** `createAdminEmailMessageIfAbsent` is a create-if-absent transaction at the deterministic id — replayed hooks / double-clicked "send" / concurrent calls collapse onto one doc with zero extra writes, and the send service NEVER invokes the transport for a `created:false` result (at most one transport call per logical send, race-backstopped by `tx.create`). A deliberate re-send is a NEW `dedupeKey` = a second, separately-audited row.

**Status machine (transaction-guarded in the DAL, nowhere else):**

```
queued ── markAdminEmailMessageSent ──▶ sent        (TERMINAL — never re-sent, never mutated)
queued ── markAdminEmailMessageFailed ─▶ failed
failed ── retryFailedEmailMessage ────▶ queued      (EXPLICIT retry only; no scheduler until T3)
```

- Invalid transitions (`markSent` on sent, retry on sent/queued) are **typed no-ops with ZERO writes** (`INVALID_STATUS` / `NOT_RETRYABLE`); missing and cross-org docs both answer `NOT_FOUND` (IDOR-safe).
- `attemptCount` is incremented by the **sent/failed transitions** (one per completed attempt) — enqueue starts at 0, `enqueue → failed → retry → sent` reads 2. The spec's "retry increments attemptCount" is realized by the retry's own attempt completing, keeping the counter = attempts under every path.
- **No `sending` state in T1** (dev transport is synchronous); a real async provider adds it later — documented seam.
- **Snapshot immutability (AC-8):** no transition touches `subject`/`bodyHtml`/`bodyText`/`from` — later template/definition edits never rewrite what was sent (OrderSnapshot parity; regression-tested).

### `EmailSettings` (root, **doc id = eventId**, 1:1 lazy, SERVER-ONLY)

```ts
interface EmailSettingsDoc {
  organizationId; eventId: string;
  fromName: string;        // ≤100, control chars stripped, `"` `<` `>` rejected
  fromAddress: string;     // RFC-shape, lowercased, ≤254, no control chars
  replyTo: string | null;
  createdAt / updatedAt;
}
```

- **Lazy lifecycle (CheckinConfig pattern):** no doc until the first save; `getAdminEmailSettingsForEvent` returns the stored doc or **null with ZERO writes** — default resolution happens IN MEMORY above the DAL (`resolveEmailSenderIdentity`, `src/lib/email/sender-identity.ts`): `fromName` = event name (header-sanitized: control chars + `"<>` stripped, "Events" if empty), `fromAddress` = env `EMAIL_DEFAULT_FROM`, `replyTo` = null.
- **Zod at write AND re-check at send:** `upsertAdminEmailSettings` parses `emailSenderIdentitySchema` (typed `VALIDATION` result → route 400s in T2); the send service re-parses the resolved identity before EVERY send and re-parses the STORED `from`/`replyTo` snapshot at retry — a doc corrupted out-of-band lands the message `failed`, never sent with a malformed header (defense in depth, §4 AC-3).
- Tenancy: getter null / upsert `CROSS_ORG` on org mismatch, zero writes. Per-event scoping only in T1 (org-level cascade = OQ-3).

## Transport abstraction (`src/lib/email/transport.ts`)

```ts
interface SendEmailInput  { messageId; from; replyTo; to; subject; bodyHtml; bodyText }  // rendered strings ONLY
interface SendEmailResult { status: "sent" | "failed"; providerMessageId: string | null; failureReason? }
interface EmailTransport  { send(input): Promise<SendEmailResult> }
```

- Mirrors the M2-T4 `PaymentProvider` precedent: the send service depends on the **interface only**; a real provider (OQ-1: SendGrid/SES/Resend) is a new class + one factory branch, zero call-site changes.
- **Selection:** `getEmailTransport()` reads env `EMAIL_TRANSPORT` — unset or `"dev-outbox"` → dev transport; **any other value THROWS a descriptive configuration error at first use (fail closed)**. The send service catches it, lands the already-created row `failed` with that reason, and returns a typed failure — never a silent fake "sent".
- **Dev outbox transport** (`dev-outbox-transport.ts`): returns `{status:"sent", providerMessageId:"dev-"+messageId}`, performs NO network I/O, never logs bodies/recipients (PII). "Sending" in dev IS writing the outbox row. Import-boundary test asserts only the factory imports the concrete class and every `src/lib/email/*` module is `"server-only"`.
- Transport is STATELESS; the outbox doc is the source of truth. `messageId` doubles as the provider idempotency key for future adapters.

## Send service (`src/lib/email/send-service.ts`) — order of operations

```
sendEventEmail(input):
  1. recipient  — Zod (emailRecipientSchema)          → typed REJECTED (INVALID_RECIPIENT), NO row
  2. render     — renderEmailTemplate (pure, per-recipient context)
                                                      → typed REJECTED (RENDER_FAILED), NO row
  3. content check — subject ≤255 chars, bodyHtml ≤256 KB, bodyText ≤64 KB (RENDERED output)
                                                      → typed REJECTED (CONTENT_TOO_LARGE), NO row
     + control chars are STRIPPED from the rendered subject here (chokepoint:
       a CR/LF in the subject TEMPLATE itself never reaches storage/transport)
  4. sender     — resolveEmailSenderIdentity + schema re-check
  5. persist    — createAdminEmailMessageIfAbsent     → created:false = DUPLICATE, no transport call
     (invalid sender from 4 → row created, then markFailed — audit shows what was attempted)
  6. deliver    — factory (fail-closed) → transport.send → markSent | markFailed (typed result)
```

**Failure taxonomy (decision, edge case 4):** *validation* failures are caller errors → typed rejections with **zero writes** (no orphaned `failed` rows); only *transport/config/sender* failures produce `failed` rows (retryable). Callers always get a typed union — never an unhandled exception (§1 AC-4).

**Batch (`sendEventEmailBatch`, T3's "Email all" substrate):** empty recipient list → `{ enqueued: 0 }` calm no-op, zero writes (edge 2). Recipient validation is **all-or-nothing**: any invalid entry → `INVALID_RECIPIENTS` with the offenders listed, nothing written (T3 may relax to partial-accept — documented seam). Rendering happens per-recipient immediately before that recipient's doc: one bad context / oversized render fails THAT entry in `results` without poisoning the rest (edge 5). `enqueued` counts NEW rows (duplicates excluded).

**Retry (`retryEmailMessage`):** DAL `failed → queued` transition (typed no-op otherwise) → stored-snapshot sender re-check → transport re-attempt → `sent | failed`. No automatic/scheduled retry in T1 — `attemptCount`/`lastError` exist now so T3 adds only the clock.

## Merge-tag renderer (`src/lib/email/merge-tags.ts` + `merge-context.ts`)

Pure sync function, no I/O: `renderEmailTemplate({subject,bodyHtml,bodyText}, context) → {…, usedTags, missingTags, unknownTags}`. Syntax `{lowercase_snake_case}`; `{}`, `{unclosed`, `{Upper}` are not tag syntax (left untouched, unreported).

Catalog (T1 canonical set — extend HERE, never fork): `event_title` `event_date` `first_name` `last_name` `full_name` `email` `company` `job_title` `ticket_name` `registration_type` `order_total` `payment_status` `qr_code` `event_url`. Sources are mapped in `buildEmailMergeContext` (Event/Attendee/submission-map/Order docs → pre-formatted strings; the caller loads docs via the DAL and pre-renders the QR SVG so the renderer stays pure):

- Attendee denorms win; **pre-accept falls back to submission keys** `first_name`/`last_name`/`email`/`company`/`job_title`; the admin-only `"—"` fallback label maps to *absent* (emails render `""`, spec table note).
- `order_total` = `amounts.totalMinor` Intl-formatted in the order currency (`formatMoney` convention); `payment_status` humanized: paid → "Paid", comped → "Complimentary", pending/outstanding/failed → "Payment due".
- `event_date` reuses `getEventBarDateLabel` (first `periods` entry + timezone, `""` when no periods); `event_url` = `/events/{eventId}` (absolute when the caller passes a baseUrl).

**Security rules (SEC-tested):** every merged value is HTML-escaped into `bodyHtml`, verbatim into `bodyText`; values merged into `subject` have CR/LF + all control chars **stripped** (header injection) — and the send service's `validateRenderedEmailContent` strips them from the full RENDERED subject again, so control chars originating in the template itself are neutralized at the shared chokepoint; from/replyTo are never merge-rendered. `{qr_code}` is the ONLY markup replacement (server-minted SVG from the deterministic M5 token — trusted, never user input), **HTML body only** — renders `""` in subject/bodyText, and the raw token string appears in no rendered output (M5-T1 AC-6 carry-over). Missing → `""` + `missingTags` (Cvent blank-field parity); unknown → literal + `unknownTags` (typo signal for T2's preview); escaped-literal syntax unsupported in T1.

## Query patterns and indexes

| Query | Method | Index |
|---|---|---|
| Outbox: `eventId == org == ORDER BY createdAt DESC LIMIT 50 [cursor]` | `listAdminEmailMessagesForEvent` | composite #1 |
| Status filter: `+ status ==` | same (Firestore-side) | composite #2 |
| Kind filter: `+ kind ==` | same (either/or — combined filters throw, no index for that shape) | composite #3 |
| Counts: `eventId == org == [status ==|kind ==] COUNT` | `countAdminEmailMessagesForEvent` | aggregate `count()`, equality-only → merge (M5 pattern, never page-length) |
| Message get / settings get / upsert | doc id (deterministic / = eventId) | n/a (doc get) |

Registered in `firestore.indexes.json` this change (all COLLECTION scope):

1. `EmailMessage`: `eventId ASC, organizationId ASC, createdAt DESC`
2. `EmailMessage`: `eventId ASC, organizationId ASC, status ASC, createdAt DESC`
3. `EmailMessage`: `eventId ASC, organizationId ASC, kind ASC, createdAt DESC`

## Read/write access rules

`firestore.rules`: explicit **deny-all** matches added for `EmailMessage` and `EmailSettings` (§5 AC-1). No client repo pairs exist — server-only by construction (RegistrationDraft/Attendee precedent; deliberate deviation from the backlog's "emailMessage.ts + admin variant" wording). No public/client enqueue path exists in T1; T2/T3 routes gate session → org → `getAdminEventForOrganization` → `write:events` and add rate limiting with the routes themselves (`src/lib/rate-limit.ts`).

## Env vars (no apphosting.yaml secrets required for T1)

| Var | Default | Posture |
|---|---|---|
| `EMAIL_TRANSPORT` | `"dev-outbox"` (unset) | unknown value **throws at first use** (fail closed — never a silent non-sending transport) |
| `EMAIL_DEFAULT_FROM` | dev fallback `events@dev.local` + ONE-TIME warn | **fails closed when a non-dev transport is configured** without it (QR_TOKEN_SECRET posture) |

## Divergences / notes for T2/T3

- **`EmailDefinition` is OUT of T1** (T2 owns its shape + screen + seeding); outbox rows carry `definitionId: null` + required `kind` so T2 joins history without a schema change.
- The send service takes `eventName` as input (default fromName) — T2/T3 callers already hold the event doc from route gating; no extra read.
- `sentAt >= queuedAt` is not asserted stronger than doc-level ordering: the synchronous dev flow may commit transitions immediately after enqueue (edge 6).
- Unsubscribe/suppression (OQ-2), domain verification/SPF/DKIM, bounce webhooks, open/click tracking: all deferred with the real-provider decision (OQ-1) — **must be resolved before any real transport ships**.
- Retention/TTL for outbox rows (registrant PII) is OQ-4 — align with the abandoned-drafts retention answer.
