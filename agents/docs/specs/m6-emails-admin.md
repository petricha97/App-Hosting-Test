# M6-T2 — Emails admin screen

Research Lead, 2026-07-14. Screen reference: `prototype/prototype/event-emails.html` (authoritative). Builds directly on `agents/docs/specs/m6-email-infrastructure.md` + `agents/docs/data-models/m6-email-infrastructure.md` (M6-T1: `EmailMessage` outbox, `EmailSettings`, transport, merge-tag renderer — all shipped, no UI) and `agents/docs/specs/m5-attendees-checkin.md` (QR identity for the preview; permissions convention). Route: `/dashboard/events/[eventId]/emails` (exists today as a coming-soon shell — `src/features/event/event-nav.ts` flips `comingSoon` off). Deps: M6-T1, M5-T1. Open-question carry-overs: **Q4 = wallet buttons remain visual placeholders**, **T1 OQ-3 resolved here: from-address is per-event** (org-level cascade stays deferred).

## Shared decisions

- **`EmailDefinition` ships in T2** (deferred from T1 by design). Root collection, SERVER-ONLY (firestore.rules deny-all, no client repo pair — recipient-facing template content + org data), canonical `organizationId` + `eventId`, `serverTimestamp()` timestamps, bounded reads — M0-T3/M5/M6-T1 DAL conventions unchanged.
- **`kind` is the join key; the definition doc id is deterministic from it:** `emailDefinitionId = sha256(JSON(["EmailDefinition", organizationId, eventId, kind]))` (same tuple-hash family as `emailMessageId.ts`). Consequences: kind is unique per event by construction; outbox history joins to a definition via the existing T1 `kind` composite index (no new `definitionId` index needed); seeding/upserts are idempotent create-if-absent.
- **Default email set is *virtual*, not seeded (decision):** the eight default lifecycle emails (catalog in §2) live in code (`src/features/emails/default-definitions.ts`). The list view merges stored `EmailDefinition` docs over the in-memory defaults by `kind`; a doc is materialized (upsert at the deterministic id) only on **first edit** (toggle, subject/body, schedule). Rationale: (a) the screen's server page gates *org membership* only (read surface, L-4 convention) — seeding on first visit would be a write without `write:events`; (b) it is the established read-time-default pattern (`CheckinConfig`, `EmailSettings`); (c) existing events need no backfill. `definitionId` on outbox rows is computable (deterministic) whether or not the doc exists.
- **T2 compose is plain text + merge tags; the designer is T4 (scope line, explicit):** T2 stores one `body` template string (plain text with `{merge_tags}`). At preview/send, `bodyText` = the template verbatim; `bodyHtml` is **derived deterministically** (HTML-escape, then paragraph/`<br>` wrapping — `{tag}` braces survive escaping, so `{qr_code}` still expands to the trusted server-minted SVG in the HTML variant only, per T1 §3). No organizer-authored raw HTML exists anywhere in T2 — that invariant is what makes the preview safe (§4) and is exactly what T4's block designer replaces. The topbar "Open Email Designer" button renders **disabled** with tooltip "Email designer arrives with M6-T4" (same pattern as M5-T3's "Email all").
- **Permissions (M5 L-4 convention, applied as-is):** the **server page** gates session → verified org membership (`getDashboardScope`) and server-fetches initial data. **Every API route** T2 adds — definition list/upsert/create, send-log reads, retry, test-send, sender-settings GET/PATCH — gates session → org → `getAdminEventForOrganization` → `write:events`, 403 / 404-IDOR per the M1–M5 convention. Mutating routes are rate-limited via `src/lib/rate-limit.ts`; payloads Zod-validated, unknown keys stripped, ≤ 32 KB bodies (carries backlog cleanup L-2 into these new routes).
- **Nothing is delivered in T2.** All sends go through T1's `sendEventEmail` → dev outbox transport; the screen's meta copy must not imply delivery (see §6 disclaimer). Trigger *configuration* is stored and displayed; trigger *evaluation* is M6-T3.

## 1 — Emails list screen (grouped tables)

*As an event organizer, I want one screen listing every lifecycle email for my event — grouped, with trigger, audience and an on/off toggle — so I can see and control what registrants will receive.*

- **Layout per prototype:** heading groups **Pre-event**, **Post-registration**, then a 2-column grid: **Debt chase & countdown** table (left) + **Confirmation email preview** card (right, §4). Topbar: "Open Email Designer" (disabled, T4 tooltip) + "+ Create email" (primary, §3). Event bar meta line: "Lifecycle-triggered messages. From `<resolved from-address>` · merge tags like `{event_title}`, `{first_name}`." — the from-address is the *resolved* sender identity (stored `EmailSettings` or read-time default) and is a link/button opening Sender settings (§6).
- **Columns:** Pre-event and Post-registration tables: Email | Trigger | Audience | Active. Debt chase table: Email | Trigger | Active (3 columns, per prototype). Row name is strong-styled; Active renders badge green "On" / neutral "Off" and is an accessible switch (not just a badge) — toggling persists immediately (optimistic, rolls back + toast on failure).
- **Trigger display strings (canonical):** `Manual`; `Auto · on submit`; `Auto · on accept`; `Auto · 24h after drop-off`; `Auto · +7 / +14 / +21d unpaid`; scheduled → datetime formatted **in the event timezone** with tz abbreviation ("Sep 8, 9:00 ET"); a scheduled definition with no datetime (event has no periods to derive from) shows neutral "Not scheduled".
- **T3-not-built honesty:** every non-manual trigger cell carries a subdued info affordance (icon + tooltip/inline note) — "Automation arrives with M6-T3; this email will not send automatically yet." Toggles still persist (they are real stored state T3 will honor). Manual-trigger definitions likewise cannot be blast-sent in T2 (manual send + "Email all" are T3); the only send affordance in T2 is the per-definition **test send** (§5).
- **Row click** opens the definition editor (§3) pre-loaded (stored doc or virtual default). Custom definitions render in their chosen group beneath the defaults, ordered by `sortOrder` then `createdAt`.

**Acceptance criteria**
1. The three groups render with exactly the prototype's default rows (names, trigger strings, audiences, all "On") on a fresh event **with zero Firestore writes** (virtual defaults asserted — no `EmailDefinition` docs created by rendering).
2. Toggling a default Off materializes its doc at the deterministic id, persists across reload, and re-toggling updates the same doc (no duplicates); the badge/switch reflects state with correct colors in both themes.
3. Scheduled rows display in the event timezone; an event with no periods shows "Not scheduled" without crashing.
4. Non-manual trigger rows show the M6-T3 note; no T2 surface offers an automatic-send or blast-send action.
5. Custom definitions appear in their group after defaults; deleting a custom definition (allowed; system defaults are not deletable — no delete affordance) removes the row after a confirm dialog.
6. "Open Email Designer" is disabled with the T4 tooltip; no navigation or network call possible.
7. Loading skeleton (grouped table shapes + preview card shape), error state with retry; page is responsive — the c2 grid stacks below ~1024px, tables scroll horizontally inside their wrap, no page-level horizontal scroll at 320px.

## 2 — `EmailDefinition` entity + default catalog

**Entity `EmailDefinition`** (root, deterministic doc id per Shared decisions): `{ organizationId, eventId, kind: string, name: string (≤120), group: "pre-event" | "post-registration" | "debt-chase", trigger: { type: "manual" } | { type: "on-submit" } | { type: "on-accept" } | { type: "abandoned-24h" } | { type: "unpaid-offsets", offsetsDays: number[] } | { type: "scheduled", at: Timestamp | null }, audience: "all-invitees" | "abandoned" | "pending-approval" | "accepted-paid" | "accepted-invoice" | "accepted-all", enabled: boolean, subject: string (template, ≤255), body: string (plain-text template, ≤32 KB — bound chosen so the worst-case escaped/wrapped derived bodyHtml stays under T1's 256 KB rendered cap), isSystem: boolean, sortOrder: number, createdAt, updatedAt }`.

- **Editability rules:** `isSystem` (the eight defaults): `subject`, `body`, `enabled`, and — for scheduled kinds — `trigger.at` are editable; `name`, `kind`, `group`, trigger *type*, and `audience` are **locked** (their kinds are the contract T3's hooks fire against). Custom definitions (`isSystem:false`): all fields editable; trigger type restricted to **`manual` | `scheduled`** in T2 (decision — lifecycle auto-triggers stay bound to system kinds until T3 defines segmentation; revisit there). Custom `kind` is server-minted `"custom-" + uuid`, never user-supplied.
- **Default catalog (T2 canonical — code, not Firestore):**

| kind | Name | Group | Trigger | Audience |
|---|---|---|---|---|
| `invitation` | Invitation | pre-event | manual | all-invitees |
| `abandoned-reminder` | Abandoned registration reminder | pre-event | abandoned-24h | abandoned |
| `approval-pending` | Approval pending notification | post-registration | on-submit | pending-approval |
| `confirmation-paid` | Registration confirmation — paid | post-registration | on-accept | accepted-paid |
| `confirmation-payment-due` | Registration confirmation — payment due | post-registration | on-accept | accepted-invoice |
| `payment-reminder` | Payment reminder 1–3 | debt-chase | unpaid-offsets [7, 14, 21] | accepted-invoice |
| `one-week-to-go` | One week to go | debt-chase | scheduled: event start − 7d, 09:00 event tz (null when no periods) | accepted-all |
| `qr-ready` | Have your QR code ready | debt-chase | scheduled: event start − 1d, 09:00 event tz (null when no periods) | accepted-all |

- All defaults ship `enabled: true` (prototype parity) with default subject/body templates defined in code using only T1 catalog tags; the two confirmation templates reproduce the prototype preview shape (subject "Registration confirmed — {event_title}"; body "Dear {first_name}, … Your pass: {ticket_name}." + `{qr_code}` + venue line). Exact copy is FS/UX polish; tags used must all be in the T1 catalog.
- **Index:** `EmailDefinition eventId ASC, organizationId ASC, createdAt ASC` (list is small and bounded — hard cap 100 definitions per event enforced at create). firestore.rules deny-all.
- **Outbox linkage:** every T2/T3 enqueue for a definition sets `EmailMessage.definitionId` = the deterministic definition id and `kind` = the definition kind (except test sends, §5). Per-definition history reads the T1 `kind`-filtered list — no T1 schema or index change.

**Acceptance criteria**
1. Doc id equals the deterministic hash; upserting the same kind twice from concurrent requests yields one doc (create-if-absent race test, M6-T1 pattern).
2. Zod rejects: unknown group/audience/trigger type, subject > 255, body > 32 KB, `offsetsDays` non-positive or non-array, editing locked fields on `isSystem` docs (400 with field errors), user-supplied `kind` on create.
3. Stored docs always win over virtual defaults in the merged list (edit subject → reload → edited subject shows; the other seven rows remain virtual).
4. Cross-org/cross-event definition reads and writes return null/404-IDOR with zero writes (two-org test).
5. `enabled:false` is respected by the send path *now*: the test-send route (§5) refuses a disabled definition with a typed error — establishing the contract T3's trigger engine must also honor (documented forward obligation).
6. Deleting a custom definition does not delete or mutate its historical `EmailMessage` rows (audit retention — history shows the kind even when the definition is gone; UI labels it with the stored kind).

## 3 — Compose / edit surface (T2 scope; designer is T4)

*As an event organizer, I want to edit an email's subject and body with merge tags and see a live preview with real data before it ever sends.*

- **Surface:** editor sheet/dialog per definition — fields per §2 editability: name (custom only), group (custom only), trigger (custom: Manual/Scheduled + datetime picker in event tz; system scheduled: datetime only), audience (custom only; label-only in T2 — evaluation is T3, noted inline), enabled switch, **subject** input, **body** textarea (plain text). "+ Create email" opens the same editor blank (defaults: group pre-event, trigger Manual, audience accepted-all, enabled On).
- **Merge-tag insertion:** an "Insert merge tag" menu listing the T1 catalog (all 14 tags) with human labels + source hints; selecting inserts `{tag}` at the cursor. `{qr_code}` is labeled "QR code — HTML body only (blank in plain text)". The catalog is imported from `src/lib/email/merge-tags.ts` — never forked.
- **Live preview pane:** renders the current subject/derived-bodyHtml through T1's `renderEmailTemplate` with a sample context (first attendee's `buildEmailMergeContext` when one exists, else the "Sample Attendee" placeholder context — M5-T4 badge-preview precedent). Warnings surfaced from the renderer's return: `unknownTags` → amber "Unknown tag {frist_name} — check spelling" (typo signal, T1 §3); `missingTags` → subdued "renders blank for this recipient". Preview HTML is produced **server-side** and displayed in a **sandboxed iframe** (`sandbox=""`, no scripts) — safe today by the no-raw-HTML invariant, and future-proof for T4 bodies.
- **Save** validates client + server (Zod), persists, updates the row; unsaved-changes guard on close.

**Acceptance criteria**
1. Editing `confirmation-paid`'s subject/body and saving materializes the doc; the list row and preview card (§4) reflect the edit; a subsequent send-test snapshot shows the *new* content while previously-sent outbox rows are unchanged (T1 §2 AC-8 regression carried forward).
2. Every catalog tag is insertable; inserted tags render in the preview from the sample context; `{qr_code}` shows a real decodable QR in the HTML preview and is absent from the plain-text preview.
3. A body containing `<script>alert(1)</script>` typed by the organizer renders as visible literal text in the preview (escaped in derived bodyHtml — XSS test); the iframe is sandboxed with no script execution.
4. Unknown-tag and missing-value warnings appear/disappear live as the template changes; neither blocks saving.
5. System definitions show locked fields as read-only (visibly, not just rejected server-side); custom create persists with a server-minted `custom-*` kind and appears in the chosen group.
6. Scheduled datetime edits display and persist in the event timezone; clearing it renders "Not scheduled".
7. Keyboard/focus: editor is fully keyboard-navigable, focus-trapped, Esc closes with the unsaved guard (both themes).

## 4 — Confirmation email preview card (prototype right column)

*As an event organizer, I want to see what the confirmation email actually looks like — QR included — without leaving the screen.*

- Renders the **`confirmation-paid`** definition (stored or default) through the same server-side pipeline as §3's preview: subject line ("Subject: Registration confirmed — GC Summit US 2026" style), body with merged sample data, **real QR SVG** (minted via M5 `mintQrToken` from the first attendee's submission; zero-attendee events show a non-scannable placeholder QR graphic — never a real token), "Delegate check-in QR" caption + venue line, and the two wallet badges **"Add to Apple Wallet" / "Add to Google Wallet" as visual placeholders (Q4 unchanged — no click action)**.
- Card links to "Edit this email" → §3 editor for `confirmation-paid`.

**Acceptance criteria**
1. With ≥1 attendee, the card shows that attendee's merged values and a decodable QR encoding the same token the M5 scanner resolves; with zero attendees, the placeholder sample renders — never a crash, never a mintable token.
2. Wallet badges render but perform no action (Q4 placeholder documented in a tooltip or title).
3. The card uses the sandboxed-iframe/server-rendered pipeline of §3 (one preview implementation, not two).
4. Raw QR tokens appear nowhere in the DOM outside the SVG geometry (M5-T1 AC-6 carry-over; L-6 invariant comment at the sink).

## 5 — Send log (outbox view) + retry + test send

*As an event organizer, I want a history of every email the system recorded — queued, sent or failed — and a way to retry failures and to test an email safely.*

- **Event-wide send log:** a "Send log" section/tab on the screen reading T1's `listAdminEmailMessagesForEvent` (newest-first, limit 50 + load-more cursor) and `countAdminEmailMessagesForEvent` for the header count. Columns: Recipient (name + email) | Email (definition name resolved from `kind`, else the raw kind for deleted/unknown kinds) | Subject | Status | Time (sentAt / failedAt / queuedAt as applicable) | Attempts. **Filters: status (All / Queued / Sent / Failed) OR kind — never combined** (T1 index constraint, surfaced as mutually-exclusive filter UI, documented).
- **Row detail:** expanding a row shows the frozen snapshot (subject, from/replyTo, rendered body in the sandboxed preview frame) + `providerMessageId` + `lastError.message` for failures. The snapshot is read-only — `sent` is terminal (T1).
- **Retry:** failed rows show a "Retry" button → `POST .../emails/messages/[messageId]/retry` → T1 `retryEmailMessage` (`failed → queued` → transport → sent/failed). Button exists **only** on failed rows; the route returns the typed `NOT_RETRYABLE`/`NOT_FOUND` results as 409/404 (server remains the guard — a stale UI retry of a since-sent row is a calm typed error, not a duplicate send). Success updates the row status + attempts in place.
- **Per-definition history:** the §3 editor includes a "History" tab = the same log component pre-filtered by the definition's `kind`.
- **Test send (the one send affordance in T2, decision):** editor action "Send test" — organizer enters a recipient email (any RFC-valid address; nothing is delivered under the dev transport — revisit restriction with OQ-2/Q2 before a real provider), server renders the definition with the §3 sample context and calls `sendEventEmail` with **`kind: "test"`**, `definitionId` = the definition's deterministic id, `dedupeKey` = server-minted uuid. Test rows therefore appear in the event-wide log under kind "test" (filterable) and never pollute a definition's real history. Disabled definitions refuse test send (§2 AC-5). Rate limit: 10/min per user per event.

**Acceptance criteria**
1. Empty state: "No emails sent yet — the log fills when automations go live (M6-T3) or when you send a test." Loading skeleton + error retry defined.
2. Statuses render as badges (queued neutral, sent green, failed red) with correct times; pagination loads the next 50 with a stable cursor (no duplicate/skipped rows across a page boundary).
3. Status and kind filters each work and cannot be combined (UI prevents it; the DAL's typed error is unreachable from this screen).
4. Retry on a failed row (seeded via a forced-failure transport double in tests) lands sent or failed-again with `attemptCount` incremented; retry affordance is absent on sent/queued rows; a raced retry of a just-sent row surfaces the typed 409, no state corruption.
5. Test send creates exactly one outbox row (`kind:"test"`, correct definitionId, frozen snapshot matching the editor content at click time); double-click creates one row per click **only** because each mints a new dedupeKey — asserted deliberately, with a short client-side in-flight guard on the button.
6. The log never renders another org's rows (two-org test); message detail for a cross-org id → 404-IDOR.
7. `lastError.message` renders as plain text (no HTML interpretation), truncated display with full text on expand.
8. **QA-1 promotion (carried from M6-T1 QA):** the row-level cross-org/cross-event same-dedupeKey test (same dedupeKey/kind/recipient across org-2/event-2 → separate rows + transport calls; same-tuple control → one row) enters the permanent suite in this ticket, per the T1 QA report's non-gating suggestion. (QA-2 — bodyHtml 256 KB boundary case — optional, same sweep.)

## 6 — Sender settings (per-event `EmailSettings` UI)

*As an event organizer, I want to set the from-name, from-address and reply-to my event's emails use, with a safe platform default when unset.*

- **Surface:** "Sender settings" panel/dialog opened from the event-bar meta line (§1). Fields: From name, From address, Reply-to (optional). When no `EmailSettings` doc exists, inputs show the **resolved defaults** (fromName = event name, fromAddress = `EMAIL_DEFAULT_FROM` resolution) with a "Platform default" hint; **viewing writes nothing** (T1 §4 AC-1).
- **Routes:** `GET`/`PATCH .../api/dashboard/events/[eventId]/emails/settings` → T1 `getAdminEmailSettingsForEvent` / `upsertAdminEmailSettings`. Validation is T1's rules verbatim (RFC-shape ≤254 lowercased addresses, no control chars; fromName ≤100, control chars stripped, `"` `<` `>` rejected) — surfaced as inline field errors from the typed `VALIDATION` result.
- **Delivery disclaimer (required copy):** the panel states that emails are not delivered in this environment (dev outbox) and that arbitrary from-addresses will require domain verification (SPF/DKIM) when a real provider ships — T1's documented Q2 deferral made visible so organizers are not misled.

**Acceptance criteria**
1. First save creates the doc; the meta line and all subsequent outbox rows (test send) snapshot the new from/replyTo; reload persists.
2. Invalid inputs (`"not-an-email"`, embedded newline, >254 chars, `<` in fromName) show field-level errors and persist nothing (route 400s with the Zod details).
3. Clearing fields back to empty restores default-resolution behavior (decision: empty fromName/fromAddress are rejected on a doc that exists — the organizer instead sees a "Reset to platform default" action that deletes/clears the override; BE picks delete-doc vs sentinel, documented in the data model).
4. GET/PATCH gate `write:events`, 404 cross-org; PATCH strips unknown keys, rate-limited.
5. Disclaimer copy renders in the panel in both themes.

## 7 — Permissions, tenancy, carried polish

- Server page: org membership (`getDashboardScope`), per the M5 L-4 clarification (read surface; Viewer-visibility refinement remains the M8-T1 forward obligation — email templates/settings and send-log recipient PII join the roster-email item on that M8-T1 decision list).
- All T2 API routes: `write:events`, 403 / 404-IDOR, Zod + unknown-key strip + ≤32 KB bodies, `rate-limit.ts` on mutations (test-send 10/min/user/event per §5).
- No client bundle contains email template content beyond what the page renders; all new DAL/lib modules stay `server-only` (T1 import-boundary test extended to `src/features/emails/server/*`).
- **Carried polish L-5 (backlog: "fold into M6-T2 polish"):** `resolve-scan.ts` / check-in confirm responses stop disclosing the admin email to team-member scanners on `ALREADY_CHECKED_IN` — return a display name or generic "Organizer" label when `checkedInBy.kind === "admin"` and the caller is a team session. One-line scope, tested.

**Acceptance criteria**
1. Every new route 403s without `write:events` and 404s cross-org/unknown eventId (route-matrix test, M5 pattern).
2. A same-org read-only member can view the page shell + server-rendered data but every API interaction (toggle, save, retry, test send, load-more) is denied — matching the M5 shipped convention exactly.
3. Two-org seed test: definitions, settings, and log rows never leak across orgs on any surface.
4. L-5: duplicate scan on a team device where an admin checked in first shows "Organizer" (or admin display name), never the email/userId.

## 8 — States & edge cases (cross-cutting)

1. **Both themes / responsive:** every table, badge, editor, preview and empty state styled for light + dark; breakpoints 320/768/1024/1440 verified; the preview iframe content itself may stay light (emails are light-bodied) — decision, noted so QA doesn't flag it.
2. **Disabled definitions:** toggle Off → neutral badge, editor banner "This email is off — it will not send when automations arrive", test send refused (typed error toast). T3 contract: the trigger engine must check `enabled` at fire time, not enqueue time (recorded forward obligation).
3. **Trigger not built (T3 absent):** all trigger cells honest per §1; nothing on this screen can cause an automatic send; QA asserts zero enqueue paths besides test-send and retry.
4. **Deleted/unknown kinds in the log:** rows whose `kind` matches no definition (e.g. deleted custom, T1-era `"manual"`, `"test"`) render the raw kind chip — never a crash or a hidden row.
5. **Event with no periods:** scheduled defaults show "Not scheduled" (§1 AC-3); preview `{event_date}` renders "" (T1 catalog rule) — visible in the missing-tags hint, not an error.
6. **Zero attendees:** preview card + sample context fall back to "Sample Attendee" (§4); test send still works (sample context, real recipient).
7. **Concurrent edits:** two tabs editing one definition — last write wins on the whole doc (upsert), documented; no partial-field merge in T2.
8. **Stuck `queued` rows** (T1 review N-2 seam — crash between create and transport): the log renders them as "Queued" with age; T2 adds **no** recovery affordance (retry is failed-only, per T1) — recovery belongs to T3's scheduler, restated here so the UI doesn't invent one.

## Non-goals for T2 (explicit)

- **No trigger evaluation, scheduler, or segmentation** — "Auto on submit/accept", +24h abandoned, +7/14/21d unpaid, scheduled fire-at, audience query evaluation, manual blast send, and M5-T3's "Email all" wiring are **M6-T3**. T2 stores and displays configuration only.
- **No email designer / block rendering / raw-HTML bodies** — **M6-T4** (button present, disabled).
- **No real delivery**: no provider, domain verification, bounce/complaint webhooks, unsubscribe/suppression (OQ-2 must resolve before any real transport), open/click tracking (M7 report reads send-log statuses only).
- **No wallet pass generation** (Q4 — buttons stay visual).
- **No org-level sender cascade** (per-event only, T1 OQ-3 resolved as per-event here), **no outbox retention/TTL** (T1 OQ-4, with Q3), **no Viewer read-only variant** (M8-T1).

## Gap analysis (current code vs. this spec)

- `src/features/emails/` does not exist; `/dashboard/(event)/events/[eventId]/emails` is a coming-soon shell; `event-nav.ts` carries `comingSoon: true, milestone: "M6"` on Emails — flip it.
- New: `src/lib/db/adminEmailDefinition.ts` + `emailDefinitionId.ts` (deterministic id helper), `src/features/emails/default-definitions.ts` (virtual catalog + default templates), `src/features/emails/server/*` (preview render, test-send service), API routes under `.../events/[eventId]/emails/` (definitions, messages + retry, test-send, settings), screen components (grouped tables, editor sheet, preview card, send log).
- Fully reusable from T1 (no changes expected): `sendEventEmail`, `retryEmailMessage`, `listAdminEmailMessagesForEvent`/`count`, `getAdminEmailSettingsForEvent`/`upsertAdminEmailSettings`, `resolveEmailSenderIdentity`, `renderEmailTemplate`, `buildEmailMergeContext`, merge-tag catalog, the three `EmailMessage` composite indexes. From M5: `mintQrToken` + QR SVG mint, badge-preview sample-attendee precedent, `rate-limit.ts`.
- `firestore.rules`: deny-all for `EmailDefinition`; `firestore.indexes.json`: the §2 composite.
- Tests: extend import-boundary test; promote QA-1 (and optionally QA-2) per §5 AC-8; L-5 fix in `src/features/checkin/server/resolve-scan.ts`.
- No new npm deps anticipated (plain textarea compose; `qrcode` present).

## Open questions

- **OQ-1 (product, non-blocking — defaulted):** should custom emails be able to select lifecycle auto-triggers (on-submit/on-accept/abandoned/unpaid) in T2, or only Manual/Scheduled as specced? Default locked: Manual/Scheduled only until T3 defines segmentation semantics; T3 revisits.
- **OQ-2 (product, non-blocking — defaulted):** test-send recipient — any valid address (specced; safe because nothing delivers) vs. restricted to the signed-in user's email. Must be re-decided **before** a real transport ships (joins T1 OQ-2's pre-Q2 checklist).
- **OQ-3 (for human, cosmetic):** prototype meta line shows `events@economist.com` — confirm there is no requirement for a verified-domain picker UI in T2 (specced as a free-form address + disclaimer; domain verification arrives with Q2's provider).
- **Carried, still open elsewhere:** Q2/T1-OQ-1 (real provider), T1-OQ-2 (unsubscribe/suppression), Q4 (wallet passes), T1-OQ-4 (outbox retention), M8-T1 Viewer matrix (now includes email surfaces, §7).

## Q&A log (append answers to other agents here)

*(empty — first entry when another agent asks an emails-screen question)*
