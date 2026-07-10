# Code Review — M3 Registration Paths & Public Flow

Reviewer: Code Reviewer agent, 2026-07-10. Scope: full uncommitted working tree on `feat/m3-registration-paths` (20 modified files, ~45 new source files, 15 new test files). Specs: `agents/docs/specs/m3-registration-paths.md` (52 ACs), `agents/docs/design/m3-registration-paths.md`, `agents/docs/data-models/m3-registration-paths.md`.

## Verdict: **CHANGES REQUESTED**

No Blockers. 7 Should-fix findings (fix within this ticket), 6 Nits. The money/state core — finalize ordering, idempotency, draft-token capability model, status machine — is correct and well-tested; the required changes are edge-case correctness, one spec-AC breach in a mixed-fee configuration, rate-limiter hardening, and hygiene.

## Checks run

- `npm run lint` — clean.
- `npx vitest run` — **40 files / 650 tests, all pass** (note for other agents: vitest 4 on Windows fails with "Vitest failed to find the runner" when invoked from a lowercase drive-letter cwd (`c:\...`); run from `C:\...`).
- `npm run build` — passes; `/events/[eventId]/register` and all new API routes compile.
- DAL grep — **no new violations**: every new `firebase-admin/firestore` import is inside `src/lib/db/` (`adminRegistrationPath.ts`, `adminRegistrationDraft.ts`, `adminFormData.ts`); public/admin routes and features stay behind the DAL.

## Verified core contracts (deep-dive, no findings)

- **Finalize contractual order** (`src/app/api/events/[eventId]/registration/finalize/route.ts:152-203`): placeOrder → createAdminFormDataForDraft → deleteAdminRegistrationDraft, asserted by call-order test. Crash replay at every partial-failure point heals: `placeOrder` replays idempotently on the same key (`src/lib/orders/place-order.ts:119-146` — and a stored `failed` order replays as PAYMENT_FAILED, never silently upgraded to success, so a crash between PAYMENT_FAILED and the attempt bump cannot mint a FormData for a failed charge); the FormData create is a create-if-absent transaction at the deterministic id (`src/lib/db/adminFormData.ts` `createAdminFormDataForDraft`, `tx.create` backstops the read/write race); draft delete is idempotent. **No replay path can double-charge.** Attempt increments only on PAYMENT_FAILED (`finalize/route.ts:166-171`); concurrent double-failures can skip a key value, which is harmless.
- **Draft token** (`src/lib/draft-token.ts`): HMAC-SHA256 over `draftId.eventId`, base64url; verification folds both sides through SHA-256 before `timingSafeEqual` (constant-time, no length leak); only the SHA-256 hash is persisted; DAL re-checks eventId + stored hash constant-time (`src/lib/db/adminRegistrationDraft.ts:104-119`). Forged tokens are rejected by `verifyDraftToken` **before** any Firestore read (`src/features/public-registration/server/context.ts:84-99`), tested (`finalize` gate test asserts `placeOrder` uncalled). Token travels in bodies/`x-draft-token` header only — no URL transport found anywhere.
- **Status machine** (`src/lib/db/formDataStatus.ts`, `transitionAdminFormDataStatus`): strict-rank forward-only inside a transaction; same-status and backward moves fail before any write (empty write set asserted in tests); accept hook fires post-commit and is unreachable twice because a re-accept fails the transactional machine check — at-most-once holds under concurrency (Firestore transaction retry re-reads the committed `accepted` state). Full 4×4 matrix + IDOR + legacy-default tests present. Optimistic UI (`responses-table.tsx:51-108`) rolls back the override on failure and refreshes on 409 — correct.
- **Form schema backward compat** (`src/features/form/schema.ts`): additive enum; `buildFormSubmissionSchema` skips commerce types; commerce fields normalized server-side (fixed key, event origin, promo always optional) so tampered payloads cannot smuggle them under other keys; `templateBuilderSchema` rejects both types and `applyTemplateToLinkedForm` defensively filters commerce fields out of stale/tampered template docs while passing the form's own event-origin commerce fields through untouched (`src/features/form/utils.ts:438-476`) — both cascade directions regression-tested.
- **Public projections**: tickets route returns id/name/code/price/availability(+choices) only; the exact-key-set test (`public-registration-tickets-route.test.ts:139-146`, `Object.keys(...).sort()`) would fail on any new field leaking. Quote returns tax `code+amount` only; promo failures collapse to one generic message everywhere (route + finalize mapping + quote), tested for identical byte-for-byte responses.
- **Config**: all 6 composite indexes from the data model are registered in `firestore.indexes.json`; `firestore.rules` deny-all for both new collections; `apphosting.yaml` wires `DRAFT_TOKEN_SECRET` as a runtime secret; registration-type delete route 409s naming blocking paths.
- **Test quality**: the ~166 new tests assert behavior (call order, write sets via the `fake-admin-db` write log, exact response shapes, worked money example $50.00 − 10% + 8.875% = $48.99, PII schema assertion on drafts, full status matrix). No snapshot padding. `src/__tests__/helpers/fake-admin-db.ts` is a faithful minimal Firestore fake including `tx.create` ALREADY_EXISTS semantics.

## Findings

### Should-fix (7)

**S1 — Step-2 displayed ticket price can diverge from the quote in mixed-fee configs (T2 AC-5 breach).**
`src/features/public-registration/server/tickets.ts:69-88` (`resolvePricingRegistrationTypeId`) + `:167-174`. For an Any-audience path with an ambiguous ticket, the card price resolves with `registrationTypeId: ""` so only an "All types" fee prices it — the comment claims this "documented conservatism" makes the displayed price always match the eventual quote. That only holds when no specific fee exists. Config: All-types fee $100 **plus** a specific fee $200 for a choosable type → card shows $100, but quote/finalize resolve the specific fee ($200, specific-wins per M2). Spec T2 AC-5: "price shown always matches the server quote for that selection." No wrong charge is possible (step-3 quote and finalize agree, and the registrant confirms the quote before paying), but the AC is breached. Fix options: also hide ambiguous tickets when any choosable type has a specific fee differing from the All-types fee; or return per-type prices in `registrationTypeOptions` and re-render the price after the "Register as" pick.

**S2 — Finalize replay after a crash can pair the replayed Order with mutated draft state.**
`src/app/api/events/[eventId]/registration/finalize/route.ts:175-200`. Window: placeOrder succeeds, response never reaches the client (crash/timeout before FormData create). The draft still exists, so the registrant can PATCH `ticket_options` to a different ticket, then retry finalize. `placeOrder` replays the **old** order (same key `reg:draftId:attempt` — correct, no double charge), but the route builds `ticketLabel`/`submission.ticket` from the **current** draft (`draft.ticketTypeId`), producing a FormData whose ticket label contradicts the order it references (money moved for ticket A, record says ticket B). Fix: derive the label from the authoritative order — look up `result.order.ticketTypeId` instead of `draft.ticketTypeId` (and take `promo_code` from `result.order.snapshot.promoCode`, which is already done). Optionally also reject `ticket_options` PATCHes once an order exists for the current attempt key.

**S3 — Rate limiter trusts the client-controllable first `x-forwarded-for` hop → trivial bypass.**
`src/lib/rate-limit.ts:79-86`. On Firebase App Hosting / GCLB the real client IP is **appended** to any client-supplied `x-forwarded-for`, so the header arrives as `<attacker-chosen>, <real-ip>, <proxy>` — taking the FIRST entry lets an attacker rotate buckets freely, defeating the 10/min promo-validation limit that is the only throttle on promo-code brute force (T2 AC-7). Take the rightmost non-proxy hop (e.g. second-from-last) instead. The in-memory/per-instance caveats themselves are documented per spec and accepted.

**S4 — `getAdminEventPromotionByCode` silently misses valid codes past the first 50 promo-enabled promotions.**
`src/lib/db/adminEventPromotion.ts` (new function, `PROMO_CODE_LOOKUP_LIMIT = 50`). The in-memory case-insensitive match runs over one unordered page (Firestore default doc-id order) — with >50 `enablePromoCode` promotions on an event, a real code can fall outside the page and report "isn't valid" nondeterministically. Per-event counts are small today, but the failure is silent and confusing. Fix: paginate to exhaustion (loop with cursor), or store a normalized `promoCodeUpper` field and use the spec's equality+limit(2) lookup. The divergence is flagged in the code comment; it needs the loop or the field, not just the flag.

**S5 — `DRAFT_TOKEN_SECRET` dev fallback stays active in production.**
`src/lib/draft-token.ts:33-52`. A missing env var falls back to a hardcoded, repo-public secret with a one-time `console.warn` — in production that makes every draft token forgeable (full read/update/finalize capability over any draft whose id is known/guessable). The data model documents this behavior, but a warn-and-continue is the wrong failure mode for a capability secret: throw on `NODE_ENV === "production"` (keep the fallback for dev/test). `apphosting.yaml` wiring is present, so the fail-fast would only trigger on misconfiguration — exactly when you want it loud.

**S6 — The two responses browsers duplicate the toolbar, export and filtered-empty logic.**
`src/features/responses/components/event-responses-browser.tsx:137-235` vs `organization-responses-browser.tsx:94-220`. Search input, status select, count badge, Export CSV button with the identical blob-anchor download sequence, and the "No submissions match these filters" panel are near-verbatim copies (~120 lines each). Design §5 specifies `responses-table.tsx (shared table+toolbar)`. Extract a shared toolbar (+ a `downloadCsv(url, filename)` helper) so the two browsers own only their deltas (event filter / load-more).

**S7 — Stray junk files in the working tree must not ship with this ticket.**
`debug.log` (repo root) and `src/app/api/dashboard/events/[eventId]/pricing/taxes/debug.log` are Chromium crashpad error logs; `prototype/contact_sheet.jpg` and `prototype/metadata/` are prototype-capture artifacts. None belong in the commit — delete them and add `debug.log` to `.gitignore` (one already landed inside an API route directory, so this will recur).

### Nits (6)

**N1** — `src/features/responses/server/ticket-labels.ts:38-40`: the fallback uses `order.snapshot.feeName` while claiming it is "what finalize denormalizes the label from" — finalize actually uses `ticket.name` (`finalize/route.ts:175-180`). Fee names and ticket names differ; join via `order.ticketTypeId` → ticket name for parity, or fix the comment.

**N2** — `src/lib/db/adminFormData.ts:27`: the DAL imports its default accept hook from `@/features/responses/on-submission-accepted` — a lib→features layering inversion (everything else flows features→lib). Move the stub under `src/lib/` or make `onAccepted` a required injection from the route.

**N3** — `transitionAdminFormDataStatus` returns `response` as the pre-transition doc spread plus `status` only — `statusUpdatedAt`/`acceptedAt` are missing from the returned object the accept hook receives; M5's attendee creation may want them.

**N4** — `src/features/public-registration/components/registration-stepper.tsx:433-446`: `handleSummaryContinue`/`handlePaymentSubmit` ignore `patchStepMarker`'s boolean — a failed marker PATCH silently proceeds. Harmless for money (finalize re-validates), but `lastStepReached` can understate progress for the abandoned surface.

**N5** — `src/lib/rate-limit.ts:55-59`: the sweep only removes expired windows, so under spoofed-IP churn (see S3) the map grows unbounded within a 60s window (bounded by request rate × window). Consider a hard cap with eviction. Low priority once S3 lands.

**N6** — `src/features/form/schema.ts` `formFieldSchema` accepts arbitrary `key` values for non-commerce fields, so a crafted API save could create a text field keyed `ticket`/`promo_code`; at finalize the display entries spread over the registrant's answer (`finalize/route.ts:190-196`). Unreachable via the builder (auto-minted keys). Add a refine reserving the two fixed keys for their commerce types.

## Spec AC spot-check summary

- T1 (paths admin): AC 1–10 implemented; delete-block 409 with bounded counts, code-dup 409 field pointer, audience foreign-id 400, inline toggle/reorder strict schemas — all route-tested.
- T2 (commerce fields): AC 1–4, 6–10 verified; **AC-5 breached in the mixed-fee config (S1)**.
- T3 (public flow): AC 1–12, 14 verified (AC-13 mobile/375px not verifiable in this review); out-of-order rejection covers both PATCH markers and finalize; double-submit and declined-retry idempotency route-tested.
- T4 (responses workflow): AC 1–10 verified; status filter is a Firestore equality (legacy-doc divergence documented in the data model, accepted).
- T5 (drafts/abandoned): AC 1–8 verified including the PII schema assertion and the single exported `ABANDONED_AFTER_MS`.

## Re-review

Return after addressing S1–S7 (and any nits you choose to take). S2/S3/S4/S5 also fall inside the Security Agent's remit — flagging them here so the fixes land before that pass.
