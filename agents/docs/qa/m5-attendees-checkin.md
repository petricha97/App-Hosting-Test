# QA Report — M5 Attendees & Check-in (M5-T1..T5)

QA Agent, 2026-07-13. Scope: `git diff e561d4e..HEAD` on `feat/m5-attendees-checkin` (commits
`2148ce8`, `ce57f19`) **plus the uncommitted working tree** (S-1 self-heal fix in
`src/lib/db/adminFormData.ts` + `src/app/api/dashboard/events/[eventId]/attendees/register/route.ts`
and its regression tests). Inputs: `agents/docs/specs/m5-attendees-checkin.md` (acceptance
criteria), `agents/docs/design/m5-attendees-checkin.md` (states/responsive/themes),
`agents/docs/reviews/m5-attendees-checkin.md` (Code Review: APPROVED, S-1 resolved),
`agents/docs/security/m5-attendees-checkin.md` (Security: PASS — M-1, L-1..L-6 non-gating).

## Automated suite (executed this session on the working tree)

| Check | Result |
|---|---|
| `npm run lint` | ✅ No ESLint warnings or errors |
| `npm run build` | ✅ Exit 0 (production build) |
| `npm test -- --run` | ✅ **72 files / 965 tests, all passing** (matches the expected S-1 baseline: 959 + 6 net-new; +2 QA `it.todo` markers for open defect D-1 after this report — suite stays green) |
| Codex second-opinion review (read-only) of the S-1 fix diff | Run per repo convention; 1 finding confirmed as defect D-1, 1 finding triaged as the spec-documented accepted gap — see Defects |

## Method

Firebase-backed flows cannot be exercised end-to-end without a live/emulated backend in this
environment. Per the QA brief, behavior was verified through the automated suite (17 M5 test
files: `qr-token`, `scanner-session`, `on-submission-accepted`, `admin-attendee`,
`admin-checkin-config`, `admin-checkin-team-member`, `attendees-roster`,
`attendees-register-route`, `attendees-list-export-routes`, `attendees-abandoned`,
`checkin-config-route`, `checkin-team-members-route`, `checkin-session-route`,
`checkin-resolve-route`, `checkin-confirm-route`, `checkin-utils`, `scan-result-card`, plus the
retrofitted `public-registration-finalize-route`, `confirmation-step`, `form-data-status`)
combined with targeted code inspection of every UI surface. Criteria that would need a running
backend are marked **CI+UT** (verified by code inspection + unit tests) with the reason.

---

## M5-T1 — Attendee entity + QR identity

| AC | Result | Evidence |
|---|---|---|
| 1. Accept creates exactly one fully-denormalized Attendee, `attendeeCreated:true` | **PASS** | `on-submission-accepted.test.ts:166` (all denorms + flag asserted) |
| 2. Duplicate accept → one doc, second invocation zero writes | **PASS** | `admin-attendee.test.ts:170` (zero-write replay), `on-submission-accepted.test.ts:265,281` (double-accept + direct double-invoke), `form-data-status.test.ts:205` (hook at-most-once) |
| 3. Legacy flat submission → null ids, "—" labels, fresh hash, no crash | **PASS** | `on-submission-accepted.test.ts:205` + degraded-orderId variants `:236,:251` |
| 4. Constant-time verify, binds eventId+submissionId, fails closed in prod | **PASS** | `qr-token.test.ts:94,110,126,144,196,216` (binding both ids, tamper, foreign secret, dev warn-once, prod throw) |
| 5. QR payload = eventId + formDataId + signature only, no PII | **PASS** | `qr-token.test.ts:77`; finalize test asserts the SVG encodes exactly the token (`public-registration-finalize-route.test.ts:242`) |
| 6. Raw tokens never persisted (only `qrTokenHash`), never in URLs | **PASS** | Schema assertions `admin-attendee.test.ts:139`, `admin-checkin-team-member.test.ts:65`; resolve/confirm are POST-body only (Security check (a) concurs) |
| 7. Finalize returns `qrSvg`; confirmation renders real QR; replay identical | **PASS** | `public-registration-finalize-route.test.ts:242` (identical replay), `confirmation-step.test.tsx:37,56` (SVG render + legacy fallback). Note: the test proves scannability by exact-SVG equality with `QRCode.toString(token)` rather than decoding via the scanner lib — an equivalent (arguably stronger) assertion; accepted deviation in test method only |
| 8. Initial state: `checkInState:"not-arrived"`, null checkedInAt/By, `status:"accepted"` | **PASS** | `admin-attendee.test.ts:107` |
| 9. Composite indexes registered | **PASS** | `firestore.indexes.json`: `Attendee (eventId, organizationId, createdAt DESC)` + `+status` + `+checkInState` variants verified present; unsupported combined filter shape guarded by explicit throw (`admin-attendee.test.ts:336`) |
| 10. firestore.rules deny-all for Attendee/CheckinConfig/CheckinTeamMember | **PASS** | `firestore.rules:302-313` — explicit `allow read, write: if false;` for all three |

**S-1 self-heal (crashed hook → orphan → manual register heals truthfully)** — **PASS**:
- Guarded hook: crash logged + `acceptHookFailed:true`, accept commit stands (`form-data-status.test.ts:216`, healthy path `:247`).
- Replay after crash re-invokes `onSubmissionAccepted` and only then 200s (`attendees-register-route.test.ts:523` — named regression for the false-200).
- Fresh accept with crashed hook retries before responding (`:538`).
- Heal failure → truthful `500 ATTENDEE_CREATION_FAILED` + log (`:553`); un-re-readable submission → 500, hook never called (`:574`).
- Healthy accept performs zero extra verification reads (`:391-394` assertions).
- Route inspection confirms ordering: non-INVALID_TRANSITION failures 500 *before* the heal block, so `!transition.ok` at the heal point can only be the idempotent replay.

## M5-T2 — Attendee roster

| AC | Result | Evidence |
|---|---|---|
| 1. Six prototype columns; green Accepted / amber Pending / "—" check-in | **PASS** | `attendees-roster.test.ts:86,104,133`; `attendees-table.tsx` + `attendee-status-badge.tsx` inspection |
| 2. Count badge = aggregate accepted count, updates after accept/manual reg | **PASS (CI+UT)** | `countAdminAttendeesForEvent` aggregate (`admin-attendee.test.ts:366`); page wires it (`attendees/page.tsx:87`); dialog success → `router.refresh()` (`attendee-list-tab.tsx:255`). Live-update needs a backend — logic verified |
| 3. Status filter, search over loaded rows, empty/loading/error states | **PASS** | Filter/search in `attendee-list-tab.tsx:105-116` (name+email, case-insensitive); route-level filter tests (`attendees-list-export-routes.test.ts:201,214`); empty state "No attendees yet" + `loading.tsx` skeleton + `EntityTableError` retry present |
| 4. Comp path → comped order + accepted FormData + Attendee; invoice → outstanding; card paths unselectable | **PASS** | Pipeline order test (`attendees-register-route.test.ts:373`), invoice-outstanding (`:434`), card rejection server-side (`:300`) + disabled SelectItem w/ tooltip in dialog (inspection) |
| 5. Ticket eligibility/capacity/pricing via placeOrder; SOLD_OUT/TYPE_FULL as dialog errors | **PASS** | `:333,346,358,455` (ineligible 400, ambiguous 400, sold-out 409 before order, SOLD_OUT → 409 with no FormData/transition); dialog renders inline destructive alert (inspection) |
| 6. Double-submit → exactly one order/submission/attendee | **PASS** | `:472` (replay same refs) + S-1 suite guarantees the attendee actually exists before 200 |
| 7. Server-side Zod validation; missing email → 400 | **PASS** | `:313` (400 before any money movement) |
| 8. CSV export honors filter, `write:events`-gated, escapes, matches on-screen | **PASS** | `attendees-list-export-routes.test.ts:239-280` (gate, columns, filter, formula-escape); export shares `loadRosterPage` with the screen (single source) |
| 9. 403 without `write:events`, 404 cross-org | **PASS** | `attendees-register-route.test.ts:265-291`, `attendees-list-export-routes.test.ts:147-158` |
| 10. Checked-in rows show "Checked in HH:mm" | **PASS** | `attendees-roster.test.ts:104,198` (column contract + HH:MM format) |

## M5-T3 — Abandoned tab

| AC | Result | Evidence |
|---|---|---|
| 1. Only `isAbandoned` drafts; strict > 24h boundary | **PASS** | `attendees-abandoned.test.ts:75` (serializer keeps only isAbandoned); boundary semantics live in the M3 DAL (`ABANDONED_AFTER_MS` imported, never copied — reviewer check 6) with M3 boundary tests |
| 2. Four step labels + prototype badge colors; blank names → "—" | **PASS** | `:105,114` (labels + amber late-steps), `:96` (blank name em-dash) |
| 3. Domain-only email masking, no local part in output | **PASS** | `:57,62,68,83` — masking is server-side; "never emits the local part" asserted |
| 4. "Email all" disabled + M6 tooltip, no network call possible | **PASS (CI+UT)** | `abandoned-tab.tsx:114-134`: `disabled` + `pointer-events-none`, no handler wired, keyboard-reachable span wrapper + `aria-describedby` per design §2 |
| 5. Row delete confirms, calls M3 purge route, removes row, decrements badge; 404 cross-org | **PASS (CI+UT)** | `AlertDialog` confirm in `abandoned-table.tsx`; DELETE to existing purge route + row filter + badge derives from `drafts.length` (`abandoned-tab.tsx:71-91`); purge-route 404 covered by M3 route tests |
| 6. Empty/loading/error states | **PASS** | Empty panel (`abandoned-tab.tsx:143-154`), `EntityTableError` retry, page `loading.tsx` |
| 7. Resumed draft leaves the tab (deleted at finalize) | **PASS** | `public-registration-finalize-route.test.ts` — `deleteAdminRegistrationDraft` call-order asserted; kept-on-failure variant (M3-T5 AC-3 regression intact) |

## M5-T4 — Check-in configuration

| AC | Result | Evidence |
|---|---|---|
| 1. Three stat cards per definitions; "event not started" caption rule | **PASS** | Aggregate counts wired in `checkin/page.tsx:86-95`; caption rule `checkin-utils.test.ts:26-58` (future/started/legacy-keys/fail-quiet); Badges ready == expected per spec decision (`checkin-stat-cards.tsx`) |
| 2. Badge preview: real decodable QR + 3 merge fields + reg-type pill; zero-attendee placeholder | **PASS (CI+UT)** | `checkin/page.tsx:44-64` re-mints the first attendee's deterministic token and renders `QRCode.toString` SVG (same token the scanner verifies — decodability follows from `qr-token` round-trip tests); `SAMPLE_BADGE` placeholder path returns muted glyph, no crash |
| 3. Five toggles persist via PATCH, survive reload, read-time defaults (no write) | **PASS** | `admin-checkin-config.test.ts:38` (defaults, ZERO writes), `:116` (patch-only update survives reload), route persistence `checkin-config-route.test.ts:126` |
| 4. Access code displayed exactly once, never retrievable again | **PASS** | `checkin-team-members-route.test.ts:97` (code returned once, DAL receives hash only); `checkin-utils.test.ts:80` (list serializer NEVER emits code material) |
| 5. Only `accessCodeHash` persisted; ≥128-bit entropy | **PASS** | Schema assertion `admin-checkin-team-member.test.ts:65`; entropy `scanner-session.test.ts:229` (32-symbol alphabet, ≥128 bits — spec says 140-bit) |
| 6. Revoke immediately invalidates scanner sessions | **PASS** | `admin-checkin-team-member.test.ts:192,211` + route-level 401 on revoked mid-session (`checkin-resolve-route.test.ts:313`, `checkin-confirm-route.test.ts:274`) |
| 7. Team-member empty state + loading/error | **PASS (CI+UT)** | Dashed empty panel in `team-members-card.tsx` per prototype; page `loading.tsx` + `CheckinLoadError` retry panel |
| 8. Routes `write:events` (403) + 404 cross-org; PATCH strips unknown keys | **PASS** | `checkin-config-route.test.ts:97-181` (gates + STRIPS unknown keys + non-boolean 400), DAL double-guard `admin-checkin-config.test.ts:141` |
| 9. `CheckinTeamMember` composite index | **PASS** | Present in `firestore.indexes.json` (eventId, organizationId, createdAt DESC) |
| 10. Wallet toggle stores boolean only; wallet buttons visual placeholders | **PASS** | Config schema boolean-only; `confirmation-step.test.tsx:77` (both wallet buttons disabled in keyboard-reachable tooltip wrappers) |

## M5-T5 — Scan flow

| AC | Result | Evidence |
|---|---|---|
| 1. Valid code opens scanner; wrong code generic error (no oracle); exchange rate-limited | **PASS** | `checkin-session-route.test.ts:79,106,120,139,159` (exchange, sloppy-entry normalization, IDENTICAL 401 for unknown/revoked, cross-org same shape, 11th attempt 429 + Retry-After) |
| 2. Expired/forged session tokens → 401 → code gate; token never in URL | **PASS** | `scanner-session.test.ts:80,114,129` (expiry, stretched-expiry tamper, swapped id/foreign secret); route 401 with no Firestore reads (`checkin-resolve-route.test.ts:289`); token held in sessionStorage, sent in bodies (inspection + Security (b)) |
| 3. Camera scan resolves attendee card WITHOUT checking in | **PASS** | `checkin-resolve-route.test.ts:162` (resolve ≠ confirm); `scan-result-card.test.tsx:31` (card + Check in button in live region) |
| 4. Manual entry resolves identically | **PASS (CI+UT)** | `scanner-surface.tsx:289-302` — manual input feeds the same `handleScan` → same resolve endpoint the route tests cover |
| 5. Confirm flips exactly once; roster + stat card reflect it | **PASS** | `admin-attendee.test.ts:403` (flip records state/at/by), roster column contract (`attendees-roster.test.ts:104`), stat card reads `checkInState` aggregate; live propagation needs a backend — logic verified |
| 6. Duplicate confirm → ALREADY_CHECKED_IN with ORIGINAL timestamp+name, zero writes, race-shaped | **PASS** | `admin-attendee.test.ts:420,449` (zero-write duplicate, race sequence), `checkin-confirm-route.test.ts:197`, amber variant carries original (`scan-result-card.test.tsx:72`) |
| 7. All five result states (WRONG_EVENT no-leak / INVALID / NOT_ACCEPTED / cancelled / success) | **PASS** | `checkin-resolve-route.test.ts:187-264` (all states incl. hash-mismatch revocation seam + garbage/tampered), `checkin-confirm-route.test.ts:230,261`, all variants rendered (`scan-result-card.test.tsx:94`) |
| 8. Admin path records `{kind:"admin",userId}` + `write:events`; team path records id+name + bumps lastSeenAt | **PASS** | `checkin-confirm-route.test.ts:173,302,325`; `checkin-session-route.test.ts:79` (lastSeenAt touch); admin resolve 403/404 (`checkin-resolve-route.test.ts:374`) |
| 9. Revoked member's next resolve/confirm → 401 | **PASS** | `checkin-resolve-route.test.ts:313,327`, `checkin-confirm-route.test.ts:274` |
| 10. Resolve/confirm rate-limited 60/min; Zod, unknown keys stripped, ≤32KB | **PASS** | `checkin-resolve-route.test.ts:336` (61st 429), malformed-body 400s; public routes use the 32KB-capped reader (Security (b) concurs) |
| 11. Mobile-first 375px; camera-denied fallback; no other attendees' data | **PASS (CI+UT)** | `scanner-surface.tsx`: `max-w-md` single-column, h-12 touch targets, `CameraOff` denied panel auto-expands manual entry (`:188-220`); resolve returns only the scanned attendee's card |
| 12. No bare attendeeId reachable; all resolution through the token | **PASS** | Route schema accepts token only; deterministic-id resolution from embedded ids; cross-tenant session replay 401 (`checkin-resolve-route.test.ts:327`); Security AC-12 check concurs |

## Cross-cutting

- **Responsive:** roster/abandoned tables in overflow containers; check-in grid `md:grid-cols-3` / `lg:grid-cols-2` stacking below; scanner designed at 375px (`max-w-md`, h-12/h-14 targets). Verified by inspection (no browser in this environment).
- **Themes:** every status/result surface pairs light/dark classes (amber-100/amber-950, emerald, violet, sky, red -50/-950 washes with -900/-200 text per design contrast note); QR blocks keep white backing in dark mode for scan contrast. Verified by inspection.
- **Loading/error/empty:** `loading.tsx` for attendees + checkin routes; `EntityTableError` retry (roster, abandoned), `CheckinLoadError` page-level retry; empty states for roster, abandoned, team members, zero-attendee badge preview — all present per design §1–3.
- **Multi-org isolation:** every DAL read/count re-checks org+event (IDOR suites in `admin-attendee`, `admin-checkin-team-member`, `admin-checkin-config`, `form-data-status`); route-level 404 cross-org tests on every new endpoint; deny-all rules for all three collections. Security review concurs.

## Defects

### D-1 (Minor, open) — Sold-out precheck in the manual-register route blocks idempotent replay and, in the crashed-hook corner, makes the S-1 self-heal unreachable
- **Ticket:** M5-T2 (touches the M5-T1 S-1 contract). **Routed to: Full-Stack Developer** (logic defect). Found via the Codex second-opinion review; confirmed by QA code-trace.
- **Affected:** `src/app/api/dashboard/events/[eventId]/attendees/register/route.ts:214-219` (`selection.soldOut` → 409 before `placeOrder`).
- **Repro (capacity boundary):**
  1. Event with a ticket that has exactly 1 seat left; comp/invoice path.
  2. Manual-register an attendee — request succeeds, consumes the last seat (order + accepted submission + attendee exist).
  3. The 200 response is lost (network drop) or the accept hook + in-request heal both crashed (truthful 500 telling the organizer to retry).
  4. Retry with the **same `requestId`**.
- **Expected:** the retry replays idempotently — `placeOrder` returns the existing order by idempotency key *before* any capacity check (`src/lib/orders/place-order.ts:141-146`), the route reaches the S-1 verification/heal block, and responds 200 with the same refs (the route's own header comment documents exactly this: "retries land on the same doc").
- **Actual:** the retry dies at the precheck with `409 SOLD_OUT` ("That ticket just sold out") — a false error for a registration that already succeeded. In variant (3b) the S-1 heal block is never reached, so the orphaned accepted submission (`attendeeCreated:false`) stays roster-invisible, its QR resolves INVALID at the door, and **no shipped code path can repair it** (the generic status route can't re-fire a terminal accept; this route was the repair path).
- **Severity: Minor.** No acceptance criterion fails as written (T2 AC-5 passes — a *fresh* full-capacity registration is still refused, enforced by `placeOrder` itself; T2 AC-6 passes — exactly one order/submission/attendee exists), no false success, no data corruption. The harmful unhealable-orphan variant requires a triple coincidence (last seat + hook crash + in-request heal crash). It does, however, deviate from the spec's "same pipeline as public finalize" (the public finalize route has **no** sold-out precheck) and undercuts the replay contract, so it should be fixed in the next cycle.
- **Recommended fix:** drop the precheck (or move it after the `placeOrder` replay lookup) — `placeOrder` already returns `SOLD_OUT`/`TYPE_FULL` which the route maps to the same 409 dialog error (tested at `attendees-register-route.test.ts:455`), restoring public-finalize parity with no loss of AC-5 coverage.
- **Regression markers added by QA:** `src/__tests__/attendees-register-route.test.ts` — `describe("QA D-1 — sold-out precheck blocks idempotent replay (open defect)")` with two `it.todo` entries (full-capacity replay returns same refs; crashed-hook orphan heals despite sold-out read). They document the exact scenarios and must be promoted to real assertions with the fix.

### Triaged, not defects
- **Codex-Medium** (generic responses status route returns 200 and ignores `acceptHookFailed`): this is the **spec-documented M5 gap** — spec T1: "hook failure must not un-accept … healed by an idempotent re-invoke" with no generic repair route in M5 scope — explicitly accepted in the Code Review re-review notes. Recommend the Orchestrator carries a backlog item (generic heal path / admin "retry attendee creation" affordance) so D-1's fix doesn't remain the only repair seam.
- Code Review nits N-1..N-8 and Security M-1 (dependency hygiene → hardening ticket), L-1..L-6 stand as recorded — none is an M5 acceptance-criteria failure. L-4 (read pages gate org membership rather than `write:events`) is a spec-vs-convention discrepancy for the Orchestrator/Research Lead to reconcile in the spec text; L-5 (admin email shown to team scanners on duplicate scans) is a worthwhile M6 polish item.
- T1 AC-7 test-method deviation (SVG-equality instead of scanner-lib decode) accepted — equality with the exact token's canonical SVG proves the same property.

## Regression tests

- **D-1:** two named `it.todo` markers added in `src/__tests__/attendees-register-route.test.ts`
  (a failing-by-design assertion cannot land while the defect is open; the todos pin the exact
  scenarios and become real tests with the fix). Suite re-run after the addition:
  19 passed + 2 todo in that file; lint clean.
- **S-1** (found by Code Review, fix verified this cycle) already carries named regression tests
  executed here: `attendees-register-route.test.ts:523,538,553,574`,
  `form-data-status.test.ts:216,247`, `on-submission-accepted.test.ts:307` — all passing in the
  965-test run.

## Verdict

**SIGNED OFF** (with one Minor defect open and routed). All acceptance criteria for M5-T1..T5
pass (criteria requiring a live Firebase backend are verified by code inspection + unit tests as
noted). Lint ✅ / Build ✅ / Tests ✅ (72 files, 965 passing + 2 QA todo markers). No open
defects of severity **Major or above** — D-1 is Minor, filed against M5-T2, routed to the
Full-Stack Developer for the next fix cycle. Hand-off to the Orchestrator to close M5-T1..T5,
carrying D-1 on the backlog.

---

## D-1 closure (QA Agent, 2026-07-13 — fix ticket M5-F1)

**Defect status: CLOSED.** The Full-Stack Developer's M5-F1 fix (Code Reviewer: APPROVED — see
the "M5-F1 (QA D-1) fix re-review" section of `agents/docs/reviews/m5-attendees-checkin.md`,
where both promoted tests were empirically confirmed to fail against the pre-fix route) was
re-verified by QA against the original defect report:

1. **Precheck removed.** `src/app/api/dashboard/events/[eventId]/attendees/register/route.ts`
   no longer contains a `selection.soldOut` → 409 short-circuit; lines ~214-218 are now a
   comment documenting why there is deliberately no precheck. `placeOrder` is the single
   capacity authority, with its idempotency-replay lookup running before any capacity check
   (`src/lib/orders/place-order.ts:141-146`) — public-finalize parity restored (the public
   finalize route never had a precheck).
2. **Both QA `it.todo` markers promoted to real assertions** —
   `src/__tests__/attendees-register-route.test.ts:613`, `describe("QA D-1 — sold-out read must
   not block idempotent replay (regression)")`:
   - "replays an already-successful registration at full capacity: same refs, not SOLD_OUT" —
     asserts `placeOrder` runs, 200 with the original `registrationRef`/`orderRef`, no
     unnecessary heal invocation;
   - "heals a crashed-hook orphan on retry even when the ticket now reads sold out" — asserts
     the retry reaches the S-1 heal block (`onSubmissionAccepted` re-invoked with the orphan)
     and only then 200s.
   Both scenarios match the closure criteria in the original D-1 filing exactly; no `it.todo`
   remains in the file.
3. **T2 AC-5 coverage preserved at both layers:** the rewritten test at `:358` ("routes a
   sold-out selection through placeOrder (no precheck, D-1) — a FRESH registration still 409s
   SOLD_OUT") plus the unchanged placeOrder-level test at `:467` (SOLD_OUT → 409, no FormData,
   no transition). A fresh full-capacity registration is still refused.
4. Also in the working tree: the Research Lead's spec amendment reconciling Security L-4
   (server pages gate org membership; mutations + API reads gate `write:events`, with an M8-T1
   forward obligation) — documentation only, records shipped behavior as intended, changes no
   acceptance criterion verified above.

**Final check numbers (re-executed on the working tree after the fix):**

| Check | Result |
|---|---|
| `npm run lint` | ✅ No ESLint warnings or errors |
| `npm run build` | ✅ Exit 0 |
| `npm test -- --run` | ✅ **72 files / 967 tests, all passing** (965 + 2 promoted D-1 regressions; 0 todo) |

**Milestone sign-off stands with ZERO open defects.** M5-T1..T5 + M5-F1: all acceptance
criteria pass, D-1 closed and pinned by regression tests, no open defects of any severity from
QA. Hand-off to the Orchestrator.
