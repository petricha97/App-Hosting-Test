# QA — M6-T1 Email Infrastructure (provider + outbox DAL)

QA Agent, 2026-07-14. Gate 3 of 3 (code review APPROVED → security PASS → **QA**).
Scope: all uncommitted changes on `feat/m6-t1-email-infrastructure` relative to
`prototype` — `src/lib/email/{transport,dev-outbox-transport,send-service,
sender-identity,merge-tags,merge-context,schemas}.ts`,
`src/lib/db/{adminEmailMessage,adminEmailSettings,emailMessageId}.ts`,
`src/types/collection.ts` additions, `firestore.rules` + `firestore.indexes.json`,
the six email test suites, and `agents/docs/data-models/m6-email-infrastructure.md`.
`HANDOVER.md` and `memory/` excluded per instructions.

Authoritative pass/fail list: the acceptance criteria in
`agents/docs/specs/m6-email-infrastructure.md`. Earlier-gate verification reused
(not redone) where the review (`agents/docs/reviews/m6-email-infrastructure.md`)
or security report (`agents/docs/security/m6-email-infrastructure.md`) already
established it; QA independently re-ran the full automated suite and traced every
criterion to a concrete test or code path below.

M6-T1 is server-side infrastructure with **no UI and no app routes** (spec §5
AC-3, confirmed: the diff touches nothing under `src/app/`), so verification is
the automated suite plus targeted code-trace — there is nothing to exercise in a
browser.

---

## Test plan

| # | Area | Method | Evidence source |
|---|------|--------|-----------------|
| 1 | Transport selection & fail-closed | Automated tests + code trace | `email-send-service.test.ts`, `email-import-boundary.test.ts`, `transport.ts` |
| 2 | Outbox lifecycle & status machine | Automated tests | `admin-email-message.test.ts`, `email-send-service.test.ts` |
| 3 | Dedupe (tenant-scoped) | Automated tests + QA ephemeral test | `email-message-id.test.ts`, `admin-email-message.test.ts`, QA run (below) |
| 4 | Merge rendering & injection safety | Automated tests | `email-merge-tags.test.ts`, S-3 chokepoint test in `email-send-service.test.ts` |
| 5 | Sender identity | Automated tests | `admin-email-settings.test.ts`, `email-send-service.test.ts` |
| 6 | Spec §6 edge cases | Automated tests | `email-send-service.test.ts` |
| 7 | Full suite on working tree | `npm run lint` / `npm run build` / `npm run test -- --run` | This session |
| 8 | Rules / indexes / route-tree | Direct diff read | `git diff prototype -- firestore.rules firestore.indexes.json` |

## Check numbers (this session, working tree)

- `npm run lint` — **exit 0**, no warnings or errors.
- `npm run build` — **exit 0**, production build clean.
- `npm run test -- --run` — **78 files / 1054 tests, all passing** (matches the
  expected 78 / 1054 from the post-fix code-review baseline).
- QA ephemeral cross-tenant dedupe test — **3/3 passing** (see criterion 3;
  run-and-removed, working tree left untouched).

---

## Per-criterion results

### 1. Transport selection — PASS

- **Default dev-outbox**: with `EMAIL_TRANSPORT` unset, a send persists the
  `EmailMessage`, marks it `sent` with `providerMessageId = "dev-" + messageId`,
  and makes **no network request** — asserted with a rejecting `fetch` spy
  (`email-send-service.test.ts:86-112`). Explicit `"dev-outbox"` also accepted
  (:114-119).
- **Unknown value fails closed**: `EMAIL_TRANSPORT="sendgrid"` throws a
  descriptive configuration error at first use (`transport.ts:53-66`, tested
  :121-125), and the already-created row lands `failed` with the reason in
  `lastError` — never silently `sent` (:127-140).
- **Rendered strings only**: `deliverQueuedMessage` hands the transport the
  *stored* rendered/sanitized snapshot fields (`send-service.ts:187-198`), and
  the interface documents/enforces the contract (`transport.ts:16-26`). The S-3
  test additionally asserts the transport payload equals the sanitized stored
  subject (`email-send-service.test.ts:324-345`).
- **Boundary**: every `src/lib/email/*.ts` module is `"server-only"`; only
  `transport.ts` imports the concrete dev transport; no Firestore access inside
  `src/lib/email/` — all three enforced by a real filesystem-walking test
  (`email-import-boundary.test.ts`).

### 2. Outbox lifecycle — PASS

- **enqueue → queued → sent**: create lands `status:"queued"`, `attemptCount:0`,
  full audit snapshot (`admin-email-message.test.ts:68-103`); the sent
  transition stores `sentAt`, `providerMessageId`, `attemptCount:1` (:141-159);
  end-to-end via the service with resolved from/replyTo
  (`email-send-service.test.ts:86-112`).
- **Forced transport failure → failed + truncated error**: transport `failed`
  result and transport **throw** both land the row `failed` with `lastError`
  and a typed result, never an unhandled exception
  (`email-send-service.test.ts:143-205`). `truncateEmailError` bounds to 500
  chars, single-line — asserted with a 2000-char multi-line error
  (`admin-email-message.test.ts:189-209`, :346-351).
- **Explicit failed → queued retry, then re-deliver**: `retryFailedEmailMessage`
  transitions only `failed → queued`; `retryEmailMessage` re-invokes the
  transport and lands `sent` with `attemptCount:2`
  (`admin-email-message.test.ts:354-383`, `email-send-service.test.ts:543-573`).
- **`sent` is terminal / typed no-ops with zero writes**: markSent, markFailed
  and retry on a non-eligible doc all return typed codes with write-counts
  asserted unchanged (`admin-email-message.test.ts:161-234`, :385-425;
  `email-send-service.test.ts:575-593`).
- **Snapshot immutability (§2 AC-8)**: no transition update ever touches
  `subject`/`bodyHtml`/`bodyText`/`from` — asserted by inspecting every
  transition write's keys (`admin-email-message.test.ts:310-344`); later
  template edits return `duplicate` and leave the stored doc byte-identical
  (`email-send-service.test.ts:225-245`).

### 3. Dedupe — PASS

- **Same (org, event, kind, recipient, dedupeKey) never creates a second row
  or a second transport call**: create-if-absent inside a transaction with
  `tx.create` backstop (`adminEmailMessage.ts:106-154`); duplicate enqueue is
  `created:false` with zero writes (`admin-email-message.test.ts:105-114`);
  the service never calls the transport for duplicates — one doc, one call
  asserted (`email-send-service.test.ts:208-223`). Case-variant recipient
  emails collapse onto one doc (:116-127).
- **Different orgs/events with the same dedupeKey DO create separate rows**:
  id-level distinctness for every tuple element is locked in
  `email-message-id.test.ts:44-56`. QA additionally verified the **row level**
  directly with an ephemeral test (same dedupeKey/kind/recipient, org-2 and
  evt-2 variants → 2 rows + 2 transport calls each; same-tuple control →
  1 row + duplicate): 3/3 passed, test removed after the run to keep the
  reviewed diff unchanged. Non-gating suggestion: fold this row-level
  assertion into the permanent suite when T2 touches these files.
- A new `dedupeKey` (deliberate re-send) produces a second, separately-audited
  row (`admin-email-message.test.ts:129-137`).

### 4. Merge rendering — PASS

- **All 14 catalog tags** render without throwing from a full context
  (`email-merge-tags.test.ts:98-114`), and `buildEmailMergeContext` maps
  realistic Event/Attendee/Order docs onto every documented source, including
  the pre-accept submission fallback, the "—" admin-sentinel → absent mapping,
  order-total/payment-status humanization, event-date and event-url derivation
  (:281-401). The confirmation-style render reproduces the prototype preview
  shape (:52-96).
- **Missing → "" + `missingTags`; unknown → literal + `unknownTags`**, empty
  string counts as missing, neither throws (:149-176).
- **HTML escaping**: `<script>alert(1)</script>` arrives escaped in `bodyHtml`,
  verbatim in `bodyText` (:117-136); all five entities, `&` first
  (`merge-tags.ts:105-112`).
- **`{qr_code}` HTML-only**: raw trusted SVG in `bodyHtml` only, `""` in
  subject/bodyText, raw token asserted absent from all rendered text with a
  real mint/verify round-trip against the M5 token (:178-219).
- **Control-char neutralization, both origins**: merged **values** into subject
  are stripped by the renderer (`merge-tags.ts:199`, `\r\nBcc:` SEC test
  :138-146); **template**-originated control chars are stripped at the
  `validateRenderedEmailContent` chokepoint and the sanitized subject is what
  gets stored and handed to the transport (`schemas.ts:112-145`,
  `email-send-service.test.ts:324-345`).
- Purity edges: empty template, only-tags, repeated/adjacent tags, `{}`,
  `{unclosed`, `{Upper}`, `{kebab-case}` untouched; deterministic output
  (:222-279).

### 5. Sender identity — PASS

- **Lazy defaults**: no `EmailSettings` doc → `fromName` = event name
  (header-sanitized), `fromAddress` = `EMAIL_DEFAULT_FROM`, zero writes, no doc
  created by the read (`admin-email-settings.test.ts:47-56`, :179-196;
  end-to-end `email-send-service.test.ts:349-357`).
- **Zod at write**: invalid address, embedded newline, >254 chars,
  header-unsafe from-name, invalid replyTo — all typed `VALIDATION` rejections
  with zero writes; addresses lowercased (:81-145). Stored settings snapshot
  into subsequent outbox rows (`email-send-service.test.ts:359-374`).
- **Re-check at send (defense in depth)**: a doc corrupted out-of-band fails
  `emailSenderIdentitySchema` at send; the row lands `failed` and the transport
  is **never called** — no malformed header can leave the service
  (`email-send-service.test.ts:376-391`); same re-check on the stored snapshot
  at retry (`send-service.ts:515-531`).
- **Dev fallback warn / fail closed**: unset `EMAIL_DEFAULT_FROM` under
  dev-outbox → `events@dev.local` with a **one-time** `console.warn`
  (module-reset tested, :233-243); a non-dev transport without the env var
  throws (:245-254).
- Cross-org getter returns null; cross-org upsert is a zero-write `CROSS_ORG`
  (:58-78, :147-175).

### 6. Spec §6 edge cases — PASS

- **Empty recipient list**: `{ ok: true, enqueued: 0, results: [] }` with zero
  writes (`email-send-service.test.ts:416-421`).
- **Size limits rejected pre-write**: subject boundary-tested at exactly
  255 (passes) / 256 (typed `CONTENT_TOO_LARGE`, zero writes) and bodyText at
  64 KiB + 1 (:268-322). bodyHtml shares the identical
  `validateRenderedEmailContent` code path (`schemas.ts:128-130`) — covered by
  trace; a dedicated 256 KiB boundary case would be a nice-to-have only.
- **Invalid recipients are typed rejections, not failed rows**: single send →
  `INVALID_RECIPIENT`, no row, no transport call (:248-266); batch is
  all-or-nothing on validation — one bad entry reports `INVALID_RECIPIENTS`
  and writes nothing (:423-452).
- **Renderer failure mid-batch**: one oversized/bad context fails only that
  recipient; the rest still send (:485-517); duplicates inside a batch don't
  re-send and don't count as enqueued (:519-540).
- Clock/ordering: `serverTimestamp()` on all lifecycle timestamps, no
  over-strong ordering assertion — matches spec §6.6.

### Permissions & tenancy (§5) — PASS

- `firestore.rules` deny-all for `/EmailMessage/{messageId}` and
  `/EmailSettings/{eventId}` — read directly in the diff.
- `firestore.indexes.json` adds exactly the three §2 composites (base /
  +status / +kind), one-to-one with the only three query shapes
  `listAdminEmailMessagesForEvent` can build; the unsupported status+kind
  combination throws before querying and is tested.
- Every DAL read/write requires `{ eventId, organizationId }`; cross-org is
  indistinguishable from missing (NOT_FOUND/null) with zero writes — tested
  for markSent, markFailed, retry, get, list, count, settings get/upsert.
- No API route added: nothing under `src/app/` in the diff.

### 7. Full suite — PASS

`npm run lint` exit 0 · `npm run build` exit 0 ·
`npm run test -- --run` → **78 files / 1054 tests passing** — exactly the
expected working-tree numbers.

---

## Defects

**None.** No Major+ (or any-severity) defects found. No regression tests were
required beyond the ephemeral cross-tenant dedupe verification (which passed
and confirmed already-correct behavior, so it was not filed as a defect fix).

### Non-gating observations (carry-over context + QA notes)

- Review nits N-1..N-5 and security Lows L-1..L-3 remain open by design
  (optional / future-ticket hardening); none gates T1.
- QA-1 (Minor, suggestion): promote the row-level cross-org/cross-event
  same-dedupeKey test into the permanent suite in T2 (currently locked at the
  id level plus QA's ephemeral run).
- QA-2 (Minor, suggestion): add a `bodyHtml` 256 KiB boundary case alongside
  the existing subject/bodyText limit tests (same code path, trace-verified).

---

## Sign-off

| Ticket | Decision |
|---|---|
| M6-T1 — Email infrastructure (transport, outbox DAL, merge renderer, sender identity) | **SIGNED OFF** |

All spec acceptance criteria (§1.1-5, §2.1-8, §3.1-6, §4.1-4, §5.1-3, §6.1-6)
pass; lint/build/full suite green at 78 files / 1054 tests; no open Major+
defects. Cleared for commit/merge.
