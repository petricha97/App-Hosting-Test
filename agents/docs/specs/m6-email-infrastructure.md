# M6-T1 — Email infrastructure (provider + outbox DAL)

Research Lead, 2026-07-13. Screen reference: `prototype/prototype/event-emails.html` (the emails admin screen ships in **M6-T2**; this ticket specs the substrate that screen and M6-T3's triggers sit on — no UI in T1). Builds on `agents/docs/specs/m5-attendees-checkin.md` (QR identity), `m2-pricing-commerce.md` (payment status), `m3-registration-paths.md` (submission lifecycle). Open-question default locked by the Orchestrator: **Q2 = dev outbox transport behind a provider interface** — emails are persisted to Firestore and viewable, **never actually delivered**, and a real provider (SendGrid/SES/Resend) later is a new transport class with zero call-site changes (mirrors the M2-T4 `PaymentProvider` precedent in `src/lib/payments/payment-provider.ts`).

## Shared decisions

- **New root collections** `EmailMessage` (the outbox / send log — one doc per recipient per logical send) and `EmailSettings` (per-event sender identity, doc id = eventId, 1:1 lazy upsert like `CheckinConfig`). Both SERVER-ONLY: firestore.rules deny-all, no client repo pairs (recipient PII), canonical `organizationId` + `eventId` on every doc, `serverTimestamp()` timestamps, bounded reads, org id in every `where()` — the M0-T3/M5 DAL conventions apply unchanged.
- **`EmailDefinition` (the rows in `event-emails.html`: name, group, trigger, audience, active) is OUT of T1.** T1's outbox rows carry a nullable `definitionId` + a required free-text `kind` (e.g. `"confirmation-paid"`, `"manual"`) so T2 can join history to definitions without a T1 schema change. Rationale: T1 must be shippable with no UI and no trigger engine; a definition entity without its screen/seeding is dead weight and T2 owns its shape.
- **Transport is stateless; the outbox doc is the source of truth.** The send service (not the transport) persists the `EmailMessage`, calls `EmailTransport.send()`, and transitions the doc's status. The dev transport performs no I/O and reports success — "sending" in dev *is* writing the outbox row.
- **Never double-send by construction:** deterministic `EmailMessage` doc id = `sha256(JSON(["EmailMessage", organizationId, eventId, kind, recipientEmailLower, dedupeKey]))` (mirrors `formDataId.ts` / `attendeeId.ts`), created with create-if-absent in a transaction. `dedupeKey` is caller-supplied per logical send (e.g. `submissionId` for a confirmation, an ISO date for a scheduled blast, a client-minted uuid for ad-hoc manual sends). Replayed hooks / double-clicked "send" collapse onto one doc with zero writes — the same idempotency shape as the M5-T1 attendee create.
- **Rendered snapshot, not template ref:** the outbox doc stores the *rendered* `subject` / `bodyHtml` / `bodyText` frozen at enqueue (audit parity with `OrderSnapshot` — later template edits never rewrite what was sent). Templates/bodies live with definitions (T2/T4).

## 1 — Transport abstraction (`src/lib/email/transport.ts` + `dev-outbox-transport.ts`)

*As the platform team, I want all email sending to go through one narrow interface so a real provider can be swapped in without touching any caller.*

Interface (shape final, names BE/FS may polish):

```ts
interface SendEmailInput {
  messageId: string;                 // outbox doc id — provider idempotency key
  from: { name: string; address: string };
  replyTo: string | null;
  to: { name: string; address: string };
  subject: string;                   // fully rendered — transport never renders
  bodyHtml: string;
  bodyText: string;
}
interface SendEmailResult {
  status: "sent" | "failed";
  providerMessageId: string | null;
  failureReason?: string;
}
interface EmailTransport { send(input: SendEmailInput): Promise<SendEmailResult>; }
```

- Selection via env `EMAIL_TRANSPORT`, default `"dev-outbox"`; an unrecognized value **throws at first use** (fail closed — never silently fall back to a non-sending transport in a configured environment). No secrets are required for the dev transport.
- Dev transport: returns `{ status: "sent", providerMessageId: "dev-" + messageId }`, performs no network I/O, never logs bodies (PII).
- The transport receives *rendered strings only* — merge rendering, validation, and persistence happen in the send service above it, so a future provider adapter is pure API mapping.

**Acceptance criteria**
1. The send service module depends only on the `EmailTransport` interface; a test doubles the transport and no production file imports `dev-outbox-transport` except the factory.
2. With `EMAIL_TRANSPORT` unset or `"dev-outbox"`, sending persists an `EmailMessage` and marks it `sent` with a `dev-` provider id; **no network request is made** (asserted by test).
3. `EMAIL_TRANSPORT="sendgrid"` (or any unimplemented value) throws a descriptive configuration error; the outbox row (if already created) lands `failed` with that reason — never silently `sent`.
4. A transport that throws or returns `failed` transitions the doc to `failed` with `lastError` captured; the enqueue caller receives a typed failure, not an unhandled exception.
5. All email modules are `"server-only"`; nothing under `src/lib/email/` is importable into client bundles (import-boundary test, same as DAL convention).

## 2 — Outbox / send-log model (`src/lib/db/adminEmailMessage.ts`)

*As an event organizer, I want every email the system sends recorded with its status and content so I can audit what a registrant received; as a developer, I want failed sends to carry the error and be safely retryable.*

**Entity `EmailMessage`** (root, deterministic id per Shared decisions): `{ organizationId, eventId, definitionId: string | null, kind: string, dedupeKey: string, recipient: { name: string, email: string }, attendeeId: string | null, submissionId: string | null, from: { name, address }, replyTo: string | null, subject: string, bodyHtml: string, bodyText: string, status: "queued" | "sent" | "failed", attemptCount: number, lastError: { message: string, at: Timestamp } | null, providerMessageId: string | null, provider: "dev-outbox", queuedAt, sentAt: Timestamp | null, failedAt: Timestamp | null, createdAt, updatedAt }`.

- **Status flow:** `queued → sent | failed`; `failed → queued` (retry) → `sent | failed`. `sent` is terminal — a `sent` doc is never re-sent or mutated (a re-send is a *new* logical send with a new `dedupeKey`). No separate `sending` state in T1: the dev transport is synchronous; a real async provider may add it later (documented seam).
- **Retry semantics:** retry = an explicit, idempotent `retryFailedEmailMessage(messageId)` DAL call that transitions only `failed → queued` (transactional guard; retrying a `sent`/`queued` doc is a typed no-op), increments `attemptCount`, then re-invokes the transport. No automatic/scheduled retry in T1 — the scheduler is M6-T3; `attemptCount`/`lastError` exist now so T3 adds only the clock.
- **Reads (T2 consumes):** `listAdminEmailMessagesForEvent({ eventId, organizationId, status?, kind?, limit = 50, startAfterCreatedAtMs? })` newest-first + `countAdminEmailMessagesForEvent` via aggregate `count()` (M5 pattern — never page-length counts). Composite indexes registered in `firestore.indexes.json`: `EmailMessage eventId ASC, organizationId ASC, createdAt DESC`; `+ status ASC` variant; `+ kind ASC` variant. Status and kind filters are **not combinable** in T1 (no index for that shape — same documented constraint style as the M5 roster).

**Acceptance criteria**
1. Enqueuing the same `{eventId, kind, recipient, dedupeKey}` twice (double-click, replayed hook, concurrent calls) yields **exactly one** doc and at most one transport call — race-tested like M5-T1 AC-2.
2. A successful send stores `status:"sent"`, `sentAt`, `providerMessageId`, rendered `subject`/`bodyHtml`/`bodyText`, and the resolved from/replyTo — the full audit snapshot.
3. A failed send stores `status:"failed"`, `failedAt`, `lastError.message` (truncated to a bounded length, no stack traces/PII), `attemptCount` incremented.
4. `retryFailedEmailMessage` on a `failed` doc re-attempts and can land `sent`; on a `sent` or `queued` doc it performs zero writes and returns a typed "not retryable" result (transaction-guarded).
5. Every doc carries `organizationId` + `eventId`; list/count DAL functions require both and results never include another org's rows (cross-org test).
6. List is bounded (limit 50 + cursor), ordered newest-first; declared indexes exactly match the query shapes (BE verifies against `firestore.indexes.json`).
7. firestore.rules adds deny-all matches for `EmailMessage` and `EmailSettings`.
8. Editing a definition/template after a send never alters existing `EmailMessage` docs (snapshot regression test).

## 3 — Merge-tag renderer + catalog (`src/lib/email/merge-tags.ts`)

*As an event organizer, I want to write `{first_name}` and `{event_title}` in subjects and bodies and have real values filled in per recipient; as a security reviewer, I want merged values to be inert (no HTML/header injection).*

Syntax `{tag_name}` (lowercase snake_case, per the prototype's meta line "merge tags like `{event_title}`, `{first_name}`"). Renderer is a **pure function**: `renderEmailTemplate({ subject, bodyHtml, bodyText }, context) → { subject, bodyHtml, bodyText, usedTags, missingTags, unknownTags }` — no I/O; callers assemble the context from the DAL.

**Catalog (T1 canonical set — T2/T3/T4 extend here, never fork):**

| Tag | Source | Notes |
|---|---|---|
| `{event_title}` | `EventDoc.name` | |
| `{event_date}` | first `EventDoc.periods` entry, formatted in `EventDoc.timezone` | "" when no periods |
| `{first_name}` `{last_name}` `{full_name}` | Attendee denorms; pre-accept falls back to submission keys `first_name`/`last_name` | `full_name` = first + " " + last, trimmed |
| `{email}` `{company}` `{job_title}` | Attendee / submission denorms | Cvent-parity: blank field renders blank, never breaks the send |
| `{ticket_name}` | `Attendee.ticketLabel` / order snapshot | "—" only in admin UIs; in email it renders "" when unknown |
| `{registration_type}` | `Attendee.registrationTypeLabel` | |
| `{order_total}` | `OrderDoc.amounts.totalMinor` + `currency`, formatted (e.g. "$1,299.00") | "" when no order (free/legacy) |
| `{payment_status}` | `OrderDoc.paymentStatus` humanized ("Paid", "Payment due", "Complimentary") | |
| `{qr_code}` | QR SVG re-minted from the deterministic M5 token (`mintQrToken(eventId, submissionId)`) | **Block tag: HTML body only** |
| `{event_url}` | public event page URL from `EventDoc` path fields | |

Rules:
- **Escaping:** every merged value is HTML-escaped before insertion into `bodyHtml`; inserted verbatim into `bodyText`. `{qr_code}` is the **only** tag whose replacement is markup (the server-generated SVG/img — trusted, never user input) and it is stripped (rendered "") in `subject` and `bodyText` (replaced by nothing; the raw token never appears in any email text — M5-T1 AC-6 carries over).
- **Header injection:** values merged into `subject` (and any future header-bound string) have CR/LF and other control characters stripped; the from/replyTo addresses are never merge-rendered at all (they come from `EmailSettings`, §4).
- **Missing value** (tag known, context value absent/empty): renders **""** — matching Cvent, where blank fields render blank and do not break data tags ([Cvent support](https://support.cvent.com/s/communityarticle/Do-blank-fields-break-data-tags)). Returned in `missingTags` so T2's preview can warn.
- **Unknown tag** (not in the catalog, e.g. a typo `{frist_name}`): left **literal** in the output and returned in `unknownTags` — silently rendering "" would hide typos from organizers; T2's preview surfaces the warning.
- Escaped-literal syntax (writing a literal `{first_name}` in copy) is **not supported** in T1 (documented; revisit with the designer in T4).

**Acceptance criteria**
1. Every catalog tag renders from its documented source; a full-context render of a confirmation-style template produces the prototype preview's content shape ("Dear Kenneth… Your pass: **Complimentary delegate**" + QR).
2. A value of `<script>alert(1)</script>` in any registrant-supplied field arrives HTML-escaped in `bodyHtml` (XSS test) and unescaped only in `bodyText`.
3. `Subject: {first_name}` with a first name containing `\r\nBcc: attacker@x.com` renders with control characters stripped — no header injection (SEC test).
4. Missing values render "" and appear in `missingTags`; unknown tags stay literal and appear in `unknownTags`; neither throws.
5. `{qr_code}` in `bodyHtml` yields a decodable QR encoding the same token the M5 scanner resolves (decode test); in `subject`/`bodyText` it renders "" and the raw token string appears nowhere in any rendered output.
6. Renderer is pure and unit-tested for: empty template, template with only tags, repeated tags, adjacent tags, `{}` and `{unclosed` left untouched.

## 4 — Sender identity (`EmailSettings`, `src/lib/db/adminEmailSettings.ts`)

*As an event organizer, I want each event to send from a configured name/address (prototype: "From `events@economist.com`") with a safe platform default when unset.*

**Entity `EmailSettings`** (root, doc id = eventId — CheckinConfig pattern): `{ organizationId, eventId, fromName: string, fromAddress: string, replyTo: string | null, createdAt, updatedAt }`. Read-time defaults when no doc exists (no lazy write on read): `fromName` = event name, `fromAddress` = env `EMAIL_DEFAULT_FROM` (dev fallback `"events@dev.local"` with a one-time console warn; **production fails closed** if a non-dev transport is configured without `EMAIL_DEFAULT_FROM` — same env posture as `QR_TOKEN_SECRET`).

Validation (Zod, server-side at write *and* re-checked at send):
- `fromAddress` / `replyTo`: RFC-shape email (`z.string().email()`), lowercased, ≤ 254 chars; no control characters.
- `fromName`: ≤ 100 chars, control characters stripped, `"` `<` `>` rejected (display-name header safety).
- Per-event scoping only in T1; an org-level default cascades later if needed (open question OQ-3). **Domain/DNS verification (SPF/DKIM) is a real-provider concern deferred with Q2** — documented so nobody assumes an arbitrary from-address will deliver once a real transport lands.

**Acceptance criteria**
1. With no `EmailSettings` doc, a send uses the documented defaults and succeeds; no doc is created by the read.
2. Upserting settings (server DAL; the write route ships with T2's screen) persists and every subsequent outbox row snapshots the new from/replyTo.
3. Invalid addresses (`"not-an-email"`, embedded newline, > 254 chars) are rejected 400-style at write; a doc corrupted out-of-band fails validation again at send time and the message lands `failed` (defense in depth), never sent with a malformed header.
4. `EmailSettings` docs carry `organizationId` and the DAL getter requires `{ eventId, organizationId }`, returning null on mismatch (IDOR-safe, M5 convention).

## 5 — Permissions & tenancy

*As an org admin, I want the outbox isolated per organization and enqueuing restricted to the server so no client can send or read mail on our behalf.*

- **No public/client enqueue path exists in T1.** Enqueue is a server-side service invoked by server code only (T3's hooks, T2's manual-send routes). Any admin-facing route T2/T3 adds gates session → org → `getAdminEventForOrganization` → `write:events`, 403 / 404-IDOR per the M1–M5 convention; outbox reads are the same (revisit read-only Viewer access in M8-T1).
- Client bundles contain no email code, provider names, or from-address material beyond what pages already render (`server-only` guard, AC 1.5).
- Rate limiting on future manual/mass-send routes is specified with those routes (T2/T3) using `src/lib/rate-limit.ts`; T1 has no HTTP surface to limit.

**Acceptance criteria**
1. firestore.rules deny-all verified for both new collections (client SDK read/write attempts fail in the rules test).
2. Every DAL read/write requires `organizationId` and cross-org access returns null/empty (tested with two seeded orgs).
3. No API route is added by T1 itself (the ticket is DAL + lib only) — route-tree diff asserted in review.

## 6 — Edge cases (cross-cutting)

1. **Duplicate sends** — covered structurally by the deterministic id + create-if-absent (§2 AC-1); *distinct logical* re-sends (organizer resends a confirmation) require a new `dedupeKey` and produce a second, separately-audited row.
2. **Empty audience** — audience segmentation is T3, but the batch enqueue helper accepts a recipient list *now* and an empty list returns `{ enqueued: 0 }` success with zero writes (T3's "Email all" with nothing abandoned must be a calm no-op, not an error).
3. **Oversized bodies** — Firestore's 1 MiB doc limit is the hard ceiling; enqueue rejects rendered `subject` > 255 chars, `bodyHtml` > 256 KB, or `bodyText` > 64 KB with a typed validation error **before** any write (no orphaned `failed` rows for caller bugs; boundary-value tested at the limits).
4. **Invalid recipients** — recipient email is Zod-validated at enqueue; invalid → typed rejection, no outbox row (validation failures are caller errors; only *transport* failures produce `failed` rows). Batch enqueue is all-or-nothing on validation: it reports the invalid entries and writes none (T3 can relax to partial-accept with per-row results if segmentation needs it — documented seam).
5. **Renderer failure mid-batch** — rendering happens per-recipient before that recipient's doc is created; one bad context (e.g. corrupt order ref) fails that recipient's enqueue without poisoning the rest of the batch.
6. **Clock/ordering** — `queuedAt`/`sentAt` are `serverTimestamp()`; the dev transport's synchronous flow may commit both in one write — `sentAt >= queuedAt` is not asserted stronger than doc-level ordering.

## Non-goals for T1 (explicit)

- **No UI** — the `event-emails.html` screen (grouped tables, preview card, "Open Email Designer", "+ Create email") is **M6-T2**.
- **No `EmailDefinition` entity, no default per-event email seeding** — T2 (outbox rows carry `definitionId: null` + `kind` until then).
- **No triggers, scheduling, segmentation, or automatic retries** — "Auto on submit/accept", "+24h abandoned", "+7/14/21d unpaid", scheduled datetimes, "Email all", and the scheduler architecture are **M6-T3**.
- **No email designer / block rendering** — **M6-T4**.
- **No real delivery**: no provider credentials, no domain verification, no bounce/complaint webhooks, no unsubscribe/suppression list (flagged for SEC review when a real transport lands — see OQ-2), no open/click tracking (M7 "Email overview" report reads send-log statuses only).
- **Wallet buttons** in the confirmation preview remain visual placeholders (Q4, unchanged from M5).

## Gap analysis (current code vs. this spec)

- `src/lib/email/` does not exist — transport interface, dev transport, factory, merge renderer, send service are all new.
- `src/lib/db/adminEmailMessage.ts`, `adminEmailSettings.ts`, and an `emailMessageId.ts` deterministic-id helper are new; **no client repo pairs** (deviation from the backlog's "emailMessage.ts + admin variant" wording, deliberate: server-only collections per the M3/M5 precedent — RegistrationDraft/Attendee likewise have no client repos).
- Reusable precedents already in place: provider-interface shape (`src/lib/payments/payment-provider.ts`), deterministic ids (`formDataId.ts`, `attendeeId.ts`), create-if-absent transaction + aggregate `count()` (`adminAttendee.ts`), 1:1 lazy config (`adminCheckinConfig.ts`), env fail-closed pattern (`qr-token.ts` / `draft-token.ts`), QR SVG mint (`src/lib/qr/`), `rate-limit.ts`.
- `firestore.rules` needs deny-all for `EmailMessage` + `EmailSettings`; `firestore.indexes.json` needs the three §2 composites.
- New env vars: `EMAIL_TRANSPORT` (optional, defaults dev), `EMAIL_DEFAULT_FROM` (optional in dev). **No apphosting.yaml secrets required for T1.**
- No new npm deps required (renderer is hand-rolled + unit-tested; `qrcode` already present). A provider SDK arrives only with Q2's answer.

## Open questions

- **OQ-1 (= backlog Q2, still open, non-blocking):** real provider + sending domain. Answer determines the second `EmailTransport` implementation, SPF/DKIM setup, and webhook ingestion for bounces.
- **OQ-2 (for human/SEC before any real transport):** unsubscribe & suppression compliance (CAN-SPAM/GDPR) — transactional confirmations generally don't need unsubscribe links, but T3's marketing-ish blasts ("One week to go") do. Not needed while nothing is delivered; **must be resolved before Q2 ships.**
- **OQ-3 (T2 design):** should from-address be editable per event (as specced) with an org-level default cascade, or org-only? Prototype shows a single per-event from line; per-event doc chosen, cascade deferred.
- **OQ-4 (T3):** retention/TTL for outbox rows containing registrant PII — align with whatever retention answer Q3 (abandoned drafts) receives.

## Q&A log (append answers to other agents here)

*(empty — first entry when another agent asks an email-behavior question)*
