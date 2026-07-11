# M5 — Attendees & Check-in

Research Lead, 2026-07-11. Screens: `prototype/prototype/event-attendees.html`, `event-checkin.html`. Builds on `agents/docs/specs/m3-registration-paths.md` + `agents/docs/data-models/m3-registration-paths.md`. Open-question defaults locked: **Q4 = wallet buttons are visual placeholders** (no Apple/Google pass generation), **Q6 = web-based camera scanner** (works on any phone; offline scanning is OUT OF SCOPE in M5 — a dropped connection shows the scan page's error state, note only).

## Shared decisions

- **New root collections** `Attendee`, `CheckinConfig` (doc id = eventId, 1:1 upsert), `CheckinTeamMember` — all SERVER-ONLY (firestore.rules deny-all, no client repo pairs), canonical `organizationId` + `eventId`, `serverTimestamp()` timestamps, bounded reads, org id in every `where()`.
- **Permissions:** every admin surface in M5 (roster, abandoned tab, manual registration, CSV export, check-in config, team members, dashboard scanner) gates on session → org → `getAdminEventForOrganization` → `write:events` (403 / 404-IDOR per M1–M3 convention). The public scanner authenticates via a **scanner access code → short-lived signed session token** (T4 decision below) — never a dashboard session.
- **One QR end-to-end (T1 decision):** the QR token is **deterministic HMAC, not stored-random**: `qrToken = "{eventId}.{formDataId}.{base64url(HMAC-SHA256(QR_TOKEN_SECRET, eventId + "." + formDataId))}"`. Divergence from "random token" justified: it mirrors `src/lib/draft-token.ts` exactly (new pure module `src/lib/qr/qr-token.ts`, separate env `QR_TOKEN_SECRET`, same fail-closed-in-prod + dev-fallback-warn pattern, constant-time verify), it is mintable at *finalize* (before the Attendee exists) and re-mintable at *accept* / email-send with zero coordination, and finalize/accept replays are idempotent by construction. Unguessable without the secret; payload carries **no PII** — eventId + an opaque submission hash id + signature only. Only `hashDraftToken`-style SHA-256 hashes are ever persisted (`qrTokenHash` on FormData and Attendee) — the stored hash is the revocation seam (rotate = re-mint under a new field—out of M5 scope, seam documented).
- **QR rendering (decision):** server-side SVG via the `qrcode` npm package (`toString(token, { type: "svg" })`) — small, maintained, zero client bundle cost; the SVG travels in API responses / server components, the raw token never appears in URLs.
- **Attendee lifecycle vs submission lifecycle:** FormData keeps `new → pending → reviewed → accepted` (terminal). Attendee is a *different record* born at accept: `status: "accepted" | "cancelled"` — `cancelled` exists in the model for forward-compat but **no cancel UI ships in M5** (documented gap; un-accept/decline remains deferred). `checkInState: "not-arrived" | "checked-in"` is orthogonal to status.

## M5-T1 — Attendee entity + QR identity (fills the M3 `onSubmissionAccepted` stub)

**Entity `Attendee`** (root, **deterministic doc id** = `sha256(JSON(["Attendee", organizationId, eventId, submissionId]))`, mirroring `src/lib/db/formDataId.ts` — duplicate accepts collapse onto one doc): `{ organizationId, eventId, submissionId, orderId: string | null, pathId: string | null, firstName / lastName / email / company / jobTitle: string ("" when the form lacks the key — denormalized from submission keys first_name/last_name/email/company/job_title), registrationTypeId: string | null, registrationTypeLabel: string (denorm; "—" fallback), ticketTypeId: string | null, ticketLabel: string ("—" for legacy flat submissions), status ("accepted" initial), checkInState ("not-arrived" initial), checkedInAt: Timestamp | null, checkedInBy: { kind: "admin", userId } | { kind: "team-member", teamMemberId, name } | null, qrTokenHash: string, createdAt, updatedAt }`. RegType/ticket denorms come from the linked Order snapshot when `orderId` is set; legacy flat submissions (null orderId) get nulls + "—" labels.

- **Hook:** `onSubmissionAccepted` (src/features/responses/on-submission-accepted.ts) becomes: mint qrToken (deterministic), create-if-absent Attendee at the deterministic id (`.create()` in a transaction; replay returns existing, zero writes), then flip `FormDataDoc.attendeeCreated = true` (+ set `qrTokenHash` on FormData if absent — covers legacy flat submissions that never went through finalize). Hook failure must not un-accept the submission: accept commit stands; hook is retried by re-running (documented — `attendeeCreated:false` + status accepted is the "hook pending" signal, healed by an idempotent re-invoke).
- **Confirmation retrofit (M3-T3 step 5):** finalize computes the qrToken, stores `qrTokenHash` on the FormData doc (additive field), and returns `qrSvg` in `FinalizeSuccess`; `confirmation-step.tsx` replaces the dashed placeholder with the real SVG ("Your entry pass"). The confirmation QR therefore encodes the **same token the Attendee later inherits** — one QR from confirmation → (M6 email / wallet) → badge → door, even though the Attendee doc doesn't exist until accept. A scan before accept resolves to the distinct **NOT_ACCEPTED** state (T5), not "invalid".

**Acceptance criteria**
1. Accepting a finalized submission creates exactly one Attendee with all denorms populated (name/email/company/jobTitle from the submission map, regType/ticket labels from the order snapshot) and `attendeeCreated:true` on the FormData.
2. Duplicate accept (double-click, replayed hook, concurrent transitions) yields exactly one Attendee doc — deterministic-id `.create()` race-tested; second invocation performs zero writes.
3. Accepting a legacy flat submission (no orderId) creates an Attendee with null regType/ticket ids, "—" labels, and a freshly minted `qrTokenHash` — no crash, no missing-field read errors.
4. `qrToken` verification is constant-time, binds eventId + submissionId, and fails closed in production when `QR_TOKEN_SECRET` is unset (dev fallback warns once) — unit tests mirror draft-token's.
5. The QR payload contains only eventId, formDataId and the signature — asserted by test; no name/email/order data decodable from the QR.
6. Raw tokens are never persisted (schema assertion: only `qrTokenHash` on FormData + Attendee) and never appear in URLs; SVG/token travel in response bodies only.
7. Finalize response includes `qrSvg`; the confirmation page renders a real scannable QR (decoded in test via the scanner lib) replacing the placeholder; finalize replay returns the identical token/SVG.
8. `checkInState` initializes "not-arrived" with null `checkedInAt`/`checkedInBy`; `status` initializes "accepted".
9. Composite index registered: `Attendee eventId ASC, organizationId ASC, createdAt DESC` (roster list); status-filtered variant `+ status ASC` if the filter is pushed to Firestore (BE decides, same convention as FormData status).
10. firestore.rules adds deny-all matches for `Attendee`, `CheckinConfig`, `CheckinTeamMember`.

## M5-T2 — Attendee roster (`event-attendees.html`, "Attendee list" tab; route `/dashboard/events/[eventId]/attendees`)

- **Columns:** Name | Email | Company | Ticket | Status | Check-in (per prototype). **Merged view decision:** the prototype shows Pending rows, but Attendee docs exist only post-accept — the roster merges (a) Attendee docs (badge green "Accepted", live check-in cell "Not arrived"/"Checked in HH:mm") and (b) FormData with status ∈ {new, pending, reviewed} rendered as amber **"Pending"** rows (granular status lives on the Responses screen) with "—" in Check-in. Status filter: All / Accepted / Pending. Count badge "N attendees" = **accepted Attendee count** (matches Expected on T4); pending rows are shown but not counted in the badge.
- **Search:** client-side filter over the loaded page (bounded lists, limit 50 + load-more cursor per M3 convention; documented limitation — server search is an M8 candidate). **CSV export** (`GET .../attendees/export`): name, email, company, ticket, registration type, status, check-in state, checked-in at; server-generated, `write:events`, same escaping rules as M3-T4 AC-6.
- **"+ Register attendee" (manual registration, minimal M5 scope):** dialog: pick path (**only paths with paymentMethod ∈ {invoice, comp, none}** — card paths disabled with tooltip "Card payments go through the public flow"; justification: no card-entry UI/PCI surface needed, and Cvent's admin-side registration is likewise offline-payment), pick ticket (path-eligible per M3-T2 rules), regType (auto per the path audience rule; picker only when ambiguous), enter personal fields (form's required non-commerce fields, minimum first/last/email). Server runs the **same pipeline as public finalize**: `placeOrder` (idempotencyKey `"manual:" + clientRequestId`, a client-minted uuid generated once per dialog open so retries collapse) → `createAdminFormDataForDraft`-equivalent create (deterministic id from the requestId) → immediate transition to `accepted` (fires the T1 hook). Justification: one code path = one set of counters/pricing/idempotency guarantees; no parallel "admin insert" that skips capacity or fees.

**Acceptance criteria**
1. Tab renders the 6 prototype columns; accepted rows show green badge + check-in cell; pre-accept submissions show amber "Pending" + "—" check-in.
2. Count badge equals the accepted Attendee count (aggregate/count query, not page length); updates after accept and manual registration.
3. Status filter All/Accepted/Pending works; search filters name/email over loaded rows; empty state ("No attendees yet — share your registration link") + loading skeleton + error retry defined.
4. Manual registration on a comp path creates Order (comped) + FormData (accepted) + Attendee in one flow; on an invoice path the order lands `outstanding`; card paths are not selectable.
5. Manual registration enforces ticket eligibility, capacity and pricing server-side via `placeOrder` — SOLD_OUT/TYPE_FULL surface as dialog errors; a full-capacity ticket cannot be force-registered.
6. Double-submit of the dialog produces exactly one order/submission/attendee (requestId idempotency).
7. Manual registration validates required form fields server-side (Zod via `buildFormSubmissionSchema` non-commerce subset); missing email → 400.
8. CSV export honors the active status filter, is `write:events`-gated, escapes correctly, matches on-screen data.
9. All routes 403 without `write:events`, 404 cross-org/unknown eventId.
10. Checked-in attendees show "Checked in" + timestamp in the Check-in column (wired by T5; column contract fixed here).

## M5-T3 — Abandoned tab (`event-attendees.html`, "Abandoned" tab)

- Reads `getAdminRegistrationDraftsForEvent` (exists; imports `ABANDONED_AFTER_MS`, never copies it). **Shows only drafts with `isAbandoned === true`**; fresher drafts are in-flight registrations, not abandoned (count badge "N abandoned" = abandoned rows).
- **Columns per prototype:** Name (firstName + lastName; "—" when blank) | Email (**masked: domain only**, "@dentsu.com" — full email never rendered on this surface per M3-T5 PII rule) | Last page reached (badge; step→label map from M3-T5: personal_info→"Personal Information", ticket_options→"Ticket & Options", summary→"Registration Summary", payment→"Payment"; amber for summary/payment, neutral otherwise per prototype) | Date (updatedAt).
- **"Email all"**: rendered disabled with tooltip "Email campaigns arrive with the Emails module (M6)" until M6-T3 wires it. **Per-row delete**: reuses the existing M3 purge route `DELETE /api/dashboard/events/[eventId]/drafts/[draftId]` with a confirm dialog. Helper copy under the table per prototype ("Knowing the last page reached…").

**Acceptance criteria**
1. Only abandoned (>24h stale) drafts render; a draft updated 23h59m ago does not appear; boundary is strict `>` (matches `ABANDONED_AFTER_MS` semantics).
2. All four step labels render with prototype badge colors; blank names render "—" without layout break.
3. Email column shows domain-only masking for every row (test asserts no local-part in the DOM).
4. "Email all" is disabled with the M6 tooltip; no network call possible.
5. Row delete confirms, calls the existing purge route, removes the row, decrements the badge; 404 cross-org.
6. Empty state: "No abandoned registrations" + explainer; loading/error states per convention.
7. Completing a previously-abandoned draft (resume) removes it from the tab (draft deleted at finalize — regression with M3-T5 AC-3).

## M5-T4 — Check-in configuration (`event-checkin.html`; route `/dashboard/events/[eventId]/checkin`)

- **Stat cards:** ✅ Checked in = Attendees with `checkInState == "checked-in"` (sub-caption "event not started" when 0 and the event start date is in the future); 🎟️ Expected = accepted Attendee count; 🖨️ Badges ready = **accepted Attendee count** in M5 (decision: every attendee's badge is generatable on demand — QR is deterministic — so ready == expected, matching the prototype's 148/148; true print tracking is the M7 "Badges printed" report).
- **Badge preview card:** renders a live sample from the first attendee (or placeholder "Sample Attendee" when zero): real QR SVG + merge fields `{full_name}` (firstName+lastName), `{job_title}`, `{company}` from Attendee denorms, reg-type pill (registrationTypeLabel), footer note "Merge fields: {full_name}, {job_title}, {company} + QR. Stock: 6"×4" double-sided."
- **Entity `CheckinConfig`** (doc id = eventId): `{ organizationId, eventId, signatureCollection: boolean, photoCapture: boolean, photoIdVerification: boolean, selfPrintBadges: boolean, walletPasses: boolean, createdAt, updatedAt }` — defaults per prototype (Off/Off/On/On/On), created lazily on first save. Toggles are **functional stored booleans; enforcement of what they gate lands later** (documented). `GET`/`PATCH .../api/dashboard/events/[eventId]/checkin/config`.
- **Team members + scanner auth (decision — simplest credible):** entity `CheckinTeamMember` `{ organizationId, eventId, name, deviceLabel, accessCodeHash (SHA-256 of a server-minted random code, 128-bit, displayed ONCE in the add dialog as e.g. "GC7Q-4KXN-P2MB-9RTD"), isActive: boolean, lastSeenAt: Timestamp | null, createdAt, updatedAt }`. The access code is the scanner's credential (T5): raw code shown exactly once, only the hash stored (draft-token hashing pattern), per-row revoke = `isActive:false`. List renders name, device label, last-seen, revoke action; empty state per prototype ("No team members yet — add staff devices to scan at the door").

**Acceptance criteria**
1. Three stat cards compute per the definitions above (aggregate count queries); checked-in card shows the "event not started" caption only when count is 0 and event start is future.
2. Badge preview shows a real decodable QR and all three merge fields + reg-type pill; zero-attendee events show the sample placeholder, never a crash.
3. Each of the 5 toggles persists via PATCH and survives reload; defaults match the prototype on first render (no doc yet — read-time defaults, no write).
4. Add-team-member dialog stores name + device label, displays the access code exactly once (never retrievable again — subsequent GETs return no code material), and lists the member.
5. Only `accessCodeHash` is ever persisted (schema assertion); codes have ≥128 bits entropy.
6. Revoking a member (`isActive:false`) immediately invalidates its scanner sessions (T5 AC-9).
7. Team-member empty state matches the prototype; loading/error states defined.
8. All routes `write:events` (403) + 404 cross-org; config PATCH strips unknown keys (Zod).
9. Index (if needed beyond equality merge): `CheckinTeamMember eventId+organizationId+createdAt DESC`.
10. Wallet-passes toggle stores a boolean only; no pass generation exists (Q4 placeholder — documented, plus the confirmation/email wallet buttons remain visual).

## M5-T5 — Scan flow (web-based, Q6)

- **Routes (aligned with T4):** public scanner `/scan/[eventId]` — access-code gate: staff enters the code, `POST /api/events/[eventId]/checkin/session` exchanges it (constant-time hash compare against active members; rate-limited 10/min/IP) for a **signed scanner session token** `"{teamMemberId}.{expiresAtMs}.{HMAC(secret, teamMemberId+'.'+eventId+'.'+expiresAtMs)}"`, TTL 12h, held in sessionStorage, sent in request bodies/headers (never URLs). Dashboard shortcut `/dashboard/events/[eventId]/checkin/scan` renders the same scanner UI authenticated by the admin session (`write:events`) — `checkedInBy.kind = "admin"`.
- **Scanning:** camera QR via the **`qr-scanner`** npm package (nimiq — small ~16kB gz, maintained, worker-based; decision) + a **manual token entry field (REQUIRED — testability + camera-denied fallback)** accepting the raw token string. Both feed the same resolve call.
- **Resolve (`POST .../checkin/resolve`):** parse token → verify HMAC against the *embedded* eventId (invalid sig → **INVALID**) → embedded eventId ≠ scanner's event → **WRONG_EVENT** ("This pass belongs to a different event" — no data about the other event leaked) → Attendee doc get at the deterministic id → missing: FormData exists with status < accepted → **NOT_ACCEPTED** ("Registration not yet accepted — direct to help desk"), else **INVALID** → stored `qrTokenHash` mismatch → INVALID (revocation seam) → status "cancelled" → INVALID variant "Registration cancelled" → success: attendee card (name, reg-type pill, ticketLabel, check-in status).
- **Confirm (`POST .../checkin/confirm`):** transactional, idempotent flip to `checked-in` + `checkedInAt` (serverTimestamp) + `checkedInBy` (scanner identity). Already checked in → **ALREADY_CHECKED_IN** result carrying original `checkedInAt` + `checkedInBy.name` — never overwritten. Result states rendered full-screen (green success / amber already / red invalid / neutral wrong-event) with "Scan next" reset. Offline: out of scope — network failure shows a retry error state (note only).

**Acceptance criteria**
1. Valid access code opens the scanner; wrong code → generic error (no oracle: revoked/unknown identical); exchange rate-limited (429 tested).
2. Expired or forged session tokens → 401 → back to the code gate; token never in a URL.
3. Camera scan of a valid attendee QR shows the attendee card (name, type pill, ticket, status) without checking in yet (resolve ≠ confirm).
4. Manual token entry resolves identically to camera scan (same endpoint, test path).
5. Confirm flips exactly once: `checkedInAt` + `checkedInBy` recorded; roster (T2) and stat card (T4) reflect it.
6. Duplicate scan/confirm (double-tap, re-scan) returns ALREADY_CHECKED_IN with the original timestamp + scanner name; the stored record is unchanged (idempotency race-tested).
7. Wrong-event token → WRONG_EVENT state, zero attendee data leaked; forged/garbage token → INVALID; valid-but-unaccepted → NOT_ACCEPTED; cancelled → cancelled variant (all five states rendered + tested).
8. Admin scanner path records `checkedInBy = {kind:"admin", userId}` and requires `write:events`; team path records teamMemberId + name and bumps `lastSeenAt`.
9. Revoked team member (T4 AC-6): existing session's next resolve/confirm → 401.
10. Resolve/confirm rate-limited per session (e.g. 60/min); payloads Zod-validated, unknown keys stripped, ≤32KB.
11. Scanner page is mobile-first (375px), works with camera permission denied (manual entry visible), and never exposes other attendees' data.
12. Cross-event/cross-org attendee ids are unreachable: all resolution flows through the token, never a bare attendeeId from the client.

## Gap analysis (current code vs. this spec)

- No `src/features/attendees/` or `src/features/checkin/`; no `src/lib/db/attendee.ts`/`adminAttendee.ts`, `checkinConfig`, `checkinTeamMember`; no `src/lib/qr/` — all new.
- `onSubmissionAccepted` is the M3 no-op stub (signature kept, body replaced per T1); `transitionAdminFormDataStatus` already guarantees at-most-once invocation.
- `FormDataDoc` needs additive `qrTokenHash?: string | null`; `FinalizeSuccess` + finalize route need `qrSvg`; `confirmation-step.tsx` placeholder swap.
- `adminRegistrationDraft.ts` already exports `ABANDONED_AFTER_MS` + `getAdminRegistrationDraftsForEvent` (with derived `isAbandoned`) and the purge route `.../drafts/[draftId]` exists — T3 is UI-only.
- `placeOrder` accepts `submissionId` and comp/invoice/none paths already — manual registration reuses it unchanged; needs only the `"manual:"` idempotency-key convention.
- Event nav (`src/features/event/event-nav.ts`): Attendees + Check-in currently render coming-soon placeholders — replace with real routes.
- New deps: `qrcode` (server SVG), `qr-scanner` (client camera). New env: `QR_TOKEN_SECRET` (apphosting.yaml secret + .env.local, same as `DRAFT_TOKEN_SECRET`).
