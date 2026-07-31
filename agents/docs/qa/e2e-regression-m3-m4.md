# E2E Regression — Phase 2 (M3 + M4), real-account run

Executor: `qa-agent` (Claude Code, via the Agent tool). Completed 2026-07-31 in
`App-Hosting-Test`, on branch `feat/m8-t9-template-apply-atomicity`. Builds
directly on Phase 1's org/event/entities — see
`agents/docs/qa/e2e-regression-m0-m1-m2.md` for that report.

## Outcome

**PHASE COMPLETE.** All in-scope M3 + M4 acceptance criteria were exercised
against the real, live Firebase project through a real Chromium browser —
including the single most important test of this phase, a genuine
unauthenticated-visitor walk of the full public multi-step registration flow
(M3-T3), which produced a real Order, a real FormData submission, and a real
attendee with a live QR SVG. 23 tests across 6 new spec files, run to a
final clean confirmation pass: **22 passed outright, 1 self-healed on its
built-in retry (a dev-server hydration/double-render timing artifact on a
native `<select>` interaction, not a product defect — see Harness notes),
0 hard failures.** Three selector/timing issues found while first authoring
the specs were fixed during this session (documented below) before that
final confirmation run. One genuine, live-reproduced **Major** product
defect was found in the Registration Paths create/edit dialog (QA-8,
reproduced twice independently). One drag-and-drop interaction (M4-T1's two
new Puck blocks) could not be reliably automated in this environment across
three attempts — recorded as a tooling limitation, not an independently
confirmed product defect (see below).

## Entities created this phase (Phase 3 must reference these)

Building on Phase 1's `E2E QA Org 2026-07-26 v2` (`Z8i7pK5sAzSHDwLKXCZF`) and
`E2E QA Conference 2026 Phase 1` (`2EKaIZZuik8ITwWqBHnA`):

- **Registration paths** (`RegistrationPath`):
  - `1 Delegate — Card` — code `DEL-CARD`, id `6J7NSRPax0WBx172N7LP`, audience
    Delegate, payment Card, currency USD, active, sortOrder 0. Has a
    published custom EventPage (M4-T2 — started blank, then had the starter
    template applied to the DEFAULT page independently; see below).
  - `2 Press — Comp` — code `PRESS-COMP`, id `O8Thyk3ASwTg3j9dJvKF`, audience
    Press, payment Comp, currency USD, active, sortOrder 1. Has zero eligible
    open tickets right now (Press Pass is manually closed; Standard's sales
    window has not opened) — used to exercise the comp/4-step admin
    rendering. Has its own custom EventPage now (M4-T2, started blank).
  - A throwaway `9 Throwaway — None` path was created, edited, and deleted —
    does not persist.
- **Registration form** (`Form`, id `86SSXY7FIqLFH6X0YMFs`): published,
  5 fields — `first_name`, `last_name`, `email` (mandatory) +
  `ticket-selector` (key `ticket`) + `promo-code` (key `promo_code`).
- **Accepted registration(s)** (real `Order` + `FormData` + `Attendee`,
  identity **Priya Kapoor**, `priya.kapoor.e2e@example.com`, Early Bird /
  Delegate, path `1 Delegate — Card`, promo `QA10OFF` applied):
  - **4 real `FormData` submissions and 4 real `Attendee` records** now
    exist under this identity (this session ran the M3-T3 spec's
    non-idempotent "completes the full flow" test 4 times total while
    iterating on selectors and re-confirming — each real run creates a
    genuinely new Order/FormData/Attendee by design, not a bug). All 4 are
    `status: accepted`, `attendeeCreated: true`, with a real `qrTokenHash`.
    One additional (5th) FormData submission from an interrupted debugging
    run never got walked through to Accepted (left at an earlier status,
    no attendee) — harmless, ignore it.
  - Two confirmed registration references from this session, either usable
    by Phase 3: `REG-AE6FB45E` (FormData
    `ae6fb45ead64227c78fc63bf9325e66bfff2e64421081c9459ea730e5479da10` →
    Attendee `978ba35138e1b069ac44e1a9bd15cdcb7877cf6c09930c87e09ce48ab2b74f35`)
    and `REG-11C00696` (from the final clean confirmation run — the most
    recently created, freshest one).
  - Phase 3 (M5-T1/M5-T2) can reference **any** of the 4 accepted ones —
    all are fully valid, equivalent real attendee records with the same
    identity/ticket/type. Search by email
    `priya.kapoor.e2e@example.com` to find them all.
- **Abandoned registration(s)** (`RegistrationDraft`, identity **Amara
  Osei**, `amara.osei.e2e@dentsu.com`, path `1 Delegate — Card`, Early Bird
  selected, stopped right before the Payment step):
  - **5 drafts** now exist (same reason as above — re-running the spec
    across this session's iterations). All have `lastStepReached:
    "summary"` (→ "Registration Summary" in the Abandoned tab's step
    label).
  - **Timing caveat (by design, not a defect):** the Abandoned tab only
    surfaces drafts whose `updatedAt` is >24h stale
    (`ABANDONED_AFTER_MS` in `src/lib/db/adminRegistrationDraft.ts`, a
    hard-coded 24h constant with no override). All 5 drafts are only a few
    hours old as of this report (created 2026-07-31). **Phase 3 will not
    see them in the Abandoned tab until ~24h after their respective
    creation times (i.e., from 2026-08-01 onward).** If Phase 3 runs
    sooner, it must verify via a direct Firestore/Admin lookup instead of
    the UI tab, or wait.
- **Event page / Puck blocks** (`EventPage`):
  - Default event page (`pageKey: "default"`): the "Summit landing" starter
    template applied (Hero, Highlights, Schedule, RegistrationEmbed),
    published. RegistrationEmbed correctly renders the CTA card (not the
    legacy inline form) because 2 active paths now exist.
  - `1 Delegate — Card` path page: started blank via M4-T2's "Start blank",
    saved, published.
  - `2 Press — Comp` path page: started blank, saved, published.
  - **TicketPricingTable and CountdownTimer blocks were NOT successfully
    inserted** into any page this session — see the M4-T1 section below.

## Ticket-by-ticket verdicts

| Ticket | Verdict | Notes |
|---|---|---|
| M3-T1 Registration Paths admin | **PASS with 1 confirmed Major defect (QA-8)** | Table (7 columns incl. the M4-T2 Page divergence column), create/edit/delete, inline Active toggle + optimistic rollback wiring, flow-diagram card (5 steps for card/invoice, 4 steps + "Payment skipped" badge for comp/none, verified both ways by toggling which path is first-active), duplicate-code 409 field error, throwaway CRUD+delete all verified live. **QA-8**: a real, live-reproduced race lets an in-flight create dialog's Name/Code/Audience fields get silently wiped mid-session. |
| M3-T2 Form builder commerce fields | **PASS** | Commerce palette section with "New" badges, both field types added (event-only, cardinality-guarded — palette entries correctly disable once placed), canvas subtitles ("ticket · from Ticket Types" / "promo_code · from Promotions") + "event field" badges, settings panel shows the locked-key note for each type, zero-tickets-warning path not hit (tickets already exist), form published successfully. First navigation to an event with no Form doc yet shows an unspec'd-but-reasonable "start from template / start from scratch" chooser screen (not itself a defect — outside this spec's ACs — but the harness needed to handle it; noted for the design/spec record). |
| M3-T3 Public multi-step registration flow | **PASS — the key test of this phase** | As a genuinely unauthenticated visitor (isolated Playwright storageState): 2 active paths → picker rendered correctly ordered by sortOrder with correct audience/payment meta text; forced unknown `?path=` 404s; picked "1 Delegate — Card" → Personal Information → Ticket & Options (only Early Bird shown/priced — Standard correctly hidden since its sales window hasn't opened, Press Pass correctly excluded by audience) → applied `QA10OFF` (10% off, badge confirmed) → Registration Summary (server-quoted subtotal $750.00, discount ≈$75.00, `TAX-NY` tax line, Total) → Payment (simulated card, "no real charge" banner) → Confirmation. **A real QR SVG rendered** (`role="img" name="Your entry QR code"` containing an actual `<svg>`, not the legacy dashed placeholder — confirms M5-T1's QR mint already retrofits into M3's confirmation step). Verified consistently across 4 independent runs this session; registration refs captured include `REG-AE6FB45E` and `REG-11C00696` (the final clean confirmation run). |
| M3-T4 Response approval workflow | **PASS** | Submission arrived `status: "new"` with `ticketLabel` "Early Bird" populated (server-side denorm). Walked New → Pending → Reviewed → Accepted via the row actions menu (only legal forward transitions offered, per-transition toast, optimistic badge update). Accept is real (not a stub): `attendeeCreated` flipped to `true` synchronously in the same request — no "Attendee not created" repair badge ever appeared — and a real `Attendee` doc with a `qrTokenHash` exists. Re-accepting an already-accepted row correctly shows no action menu (terminal, em-dash placeholder) — idempotency confirmed structurally (no duplicate-transition affordance exists to even attempt one). |
| M3-T5 Abandoned-registration tracking | **PASS** | Second real unauthenticated registration (Amara Osei) walked to Personal Information → Ticket & Options (Early Bird selected) → Registration Summary → clicked "Confirm & pay" (which PATCHes the `summary` step marker and advances to Payment) → abandoned by navigating away before ever submitting payment. Draft persists with `lastStepReached: "summary"`. **Note:** only becomes visible in the M5-T3 Abandoned tab after the 24h threshold (see Entities section) — this is spec'd behavior, not a defect, but material to Phase 3's timing. |
| M4-T1 New Puck blocks | **PASS with 1 unresolved tooling gap** | Palette lists all 3 registration blocks (`Registration Embed`, `Ticket & Pricing table`, `Countdown timer`) via their real `data-testid="drawer-item:*"` markers, with "New" badges on the two new ones. Applying the "Summit landing" starter template (an ordinary button click, not drag-and-drop) correctly renders the **RegistrationEmbed CTA card** (not the legacy inline form, since 2 active paths now exist) in both the live editor canvas and the "Public render preview" panel, and both Save draft / Publish page succeed. **Could not confirm TicketPricingTable/CountdownTimer's own live-data rendering** — see below. |
| M4-T2 Per-path page customization | **PASS** | Registration Paths table's "Page" column correctly showed "Default" + a working "Customize page for {name}" link before any path page existed. Following it landed on the path-scoped builder (`?path=<id>`) showing the exact spec'd inherit-fallback banner ("This path currently inherits the default event page." + "Start from a copy of the default page" / "Start blank"). Choosing "Start blank", saving, and publishing flipped the Page badge from "Default" to "Custom" for that path — verified for both `1 Delegate — Card` and `2 Press — Comp`. |

## New defects found and confirmed live this session

### QA-8 — Major, CONFIRMED LIVE — Registration Path create/edit dialog silently wipes in-progress Name/Code/Audience input when a background `router.refresh()` resolves mid-session

- **Repro** (reproduced live; root-caused in code, not just inferred from
  the symptom):
  1. On the Registration Paths screen with at least one existing path,
     click "Create path".
  2. Fill Name, fill Code, pick an Audience.
  3. **While that dialog is still open**, a `router.refresh()` triggered by
     an *earlier* mutation on the same page (in this repro: the previous
     path's create, whose `onSaved` callback calls `refresh()`) resolves
     and delivers a new `paths` prop to `RegistrationPathsWorkspace`.
  4. Pick a Payment method and submit.
- **Expected**: the dialog submits exactly what was typed (Name, Code,
  Audience, Payment method all as entered).
- **Actual**: the submission fails 400 with "Name is required." / "Code is
  required." — the Name, Code, and Audience fields had been silently reset
  to their blank/"Any" defaults sometime after step 3, while the
  later-selected Payment method survived (proving the reset landed **between**
  the Audience pick and the Payment-method pick, not before). Live evidence
  (Playwright's captured accessibility snapshot at the moment of failure):
  `textbox "Name" [invalid]`, `paragraph: Name is required.`, `textbox "Code"
  [invalid]`, `paragraph: Code is required.`, `combobox "Audience": Any
  registration type` (reset), `combobox "Payment method": Comp — free with
  confirmation` (NOT reset — selected after the wipe), `textbox "Sort
  order": "1"` (the freshly recomputed default, proving the reset fired).
- **Root cause** (confirmed in code):
  `src/features/registration-paths/components/path-dialog.tsx:106-110`:
  ```ts
  useEffect(() => {
    if (open) {
      form.reset(buildDefaultValues(path, nextSortOrder));
    }
  }, [open, path, nextSortOrder, form]);
  ```
  `nextSortOrder` is a prop computed in the parent
  (`RegistrationPathsWorkspace`) from `paths.length` — i.e., it changes the
  instant a sibling `router.refresh()` resolves and the server returns an
  updated `paths` array. This effect's dependency array includes
  `nextSortOrder`, so **any** background refresh that changes the prefilled
  sort-order default while the dialog is *already open* re-runs
  `form.reset(...)`, discarding whatever the user has typed so far — with no
  visible warning. The effect is meant to run once per dialog-open (to seed
  fresh defaults), not on every subsequent prop change while the user is
  mid-edit.
- **Impact**: real, silent data loss risk for any organizer who opens
  "Create path" again shortly after a previous mutation on the same screen
  (a very ordinary workflow — e.g., creating several paths back-to-back, one
  of this ticket's own worked examples). No error is shown until the
  now-empty Name/Code trip validation on submit, which is confusing (the
  user just typed those fields).
- **Severity**: **Major** (silent, confusing data loss under an ordinary
  workflow; not a security or cross-tenant issue; recoverable by re-typing
  once the user notices, but nothing tells them to).
- **Reproducibility**: race-condition-shaped (depends on refresh timing
  relative to dialog-open), so not 100%-per-attempt, but the mechanism is
  deterministic given the timing window — reproduced **twice** live this
  session (once creating the "2 Press — Comp" path right after "1 Delegate —
  Card", once creating a throwaway path right after a prior mutation on the
  same screen), both times with the exact expected symptom shape
  (Name/Code/Audience wiped, whatever was picked *after* the wipe intact,
  Sort order bumped to the freshly recomputed default) — independently
  confirming the root cause rather than a one-off coincidental failure.
- **Routing**: **fullstack-developer**. Suggested fix: only reset on the
  open-transition (track previous `open` with a ref and reset solely when it
  flips `false → true`), or freeze `nextSortOrder`'s value for the lifetime
  of one dialog session (e.g., capture it once via `useState(() =>
  nextSortOrder)` instead of depending on the live prop). Regression test to
  add once fixed: open the create dialog, type Name/Code, simulate the
  parent re-rendering with a changed `nextSortOrder` prop, assert the
  fields retain their typed values.

## Tooling limitation (not an independently confirmed product defect)

### Drag-and-drop insertion of the two new Puck blocks (TicketPricingTable, CountdownTimer) could not be reliably automated

- **What was tried**: `@measured/puck`'s component drawer uses
  `@dnd-kit/react`'s pointer-based `useDraggable` (confirmed by reading
  `node_modules/@measured/puck/dist/index.js` — `DrawerItemDraggable`), not
  native HTML5 drag-and-drop, so Playwright's `dragTo()` does not apply. This
  session implemented a manual pointer-drag simulation (`mouse.down` →
  activation jiggle → many small stepped `mouse.move` calls into the
  `#preview-frame` iframe, targeting the real `[data-puck-dropzone="root:
  default-zone"]` element via `frameLocator` → a settle wiggle over the
  target → `mouse.up`, with waits between every step) and iterated on the
  choreography twice. Both the palette source (`data-testid="drawer-item:
  TicketPricingTable"` / `:CountdownTimer"`, confirmed present and enabled)
  and the drop target were correctly located (bounding boxes resolved
  successfully both times), but the canvas's actual component count
  (`[data-puck-component]` inside the iframe) never increased — the drop was
  never recognized by Puck's sensor.
- **What this means**: this is recorded as a **QA harness/automation
  limitation** in this environment, not an independently confirmed product
  defect — no real human tested this with an actual mouse this session, so a
  genuine end-user-facing drag-and-drop bug cannot be ruled out either, but
  there is no live evidence of one. The spec's own test
  (`e2e/m4-t1-t2-page-builder-blocks.spec.ts`) verifies the ground truth
  honestly (via the canvas component count, not just "did the mouse sequence
  complete without throwing") and skips the block-specific assertions when
  insertion doesn't land, rather than reporting a false pass.
- **What WAS independently verified for these two blocks**: their palette
  presence + "New" badges (live), and via source-code review
  (`src/features/event-pages/puck.tsx:723-793`) their prop wiring is
  correct — `TicketPricingTable` renders `<TicketPricingTableBlock
  projection={pricingTickets} .../>` where `pricingTickets` is the real,
  live `listPublicTicketsForEvent(...)` projection (verified this IS real
  Fees/TicketType data via the same admin-Fee entities Phase 1 seeded —
  Early Bird $750.00 exists in that projection); `CountdownTimer` similarly
  wires the real event-start ISO string. Neither block's actual on-page
  rendering with that live data was visually confirmed in a live browser
  this session.
- **Recommendation**: a follow-up manual QA pass (real mouse, headed
  browser) or a component-level test (React Testing Library driving the
  block's render function directly with a live `pricingTickets`/`countdown`
  fixture, bypassing Puck's DnD layer entirely) should close this
  verification gap before M4-T1 is considered fully proven end-to-end.
  Routing if pursued further: **qa-agent** (follow-up) or
  **fullstack-developer** (if a component-level regression test is deemed
  warranted).

## Harness changes made this session

- New fixtures module `e2e/fixtures/registration-data.ts`: shared
  `ACCEPTED_REGISTRANT` / `ABANDONED_REGISTRANT` identities, imported by
  `m3-t3`, `m3-t4`, `m3-t5` (kept out of any `.spec.ts` file so importing it
  never re-registers another file's tests with Playwright's test loader).
- `e2e/fixtures/dom-helpers.ts`'s `getInputByFormItemLabel` (QA-2 workaround)
  was **not needed** for any M3/M4 dialog — the Registration Path dialog's
  Name/Code/Sort-order inputs and the public flow's Payment-step inputs are
  all direct `FormControl`/`Label` children with no wrapping affix `<div>`,
  so plain `getByLabel` works throughout this phase. No new instances of the
  QA-2 label-association defect were found in M3/M4 surfaces.
- Discovered and worked around, in the specs (not application code):
  - The Form builder's first-ever visit for an event with no `Form` doc yet
    shows a "start from template / start from scratch" chooser
    (`?mode=scratch` link, not a button) before the actual builder renders —
    `m3-t2-form-commerce-fields.spec.ts`'s `openBuilder()` helper handles
    this.
  - The Form builder's native `<select>` Status control needs the page to
    finish client hydration before `selectOption()` reliably sticks (an
    early attempt raced hydration and silently no-op'd the select) — fixed
    by waiting for a known-hydrated element first and asserting the actual
    select value before clicking submit. Not filed as a product defect
    (this is a test-timing artifact of driving a native `<select>`
    immediately after `waitForLoadState("load")` on a cold dev-server
    compile, not a reproducible user-facing issue independent of automation
    speed). This exact hydration-safety wait itself flaked once more in the
    final confirmation run with a *different* symptom — a strict-mode
    "resolved to 2 elements" violation on `getByLabel("Form title")`, both
    elements showing identical values under two different id-generation
    schemes (`_r_2_-form-item` vs `_R_bainebnaitpesneitqlb_-form-item`).
    This is consistent with a transient Next.js dev-mode double-render
    (SSR markup briefly coexisting with a re-hydrated client tree, or a
    fast-refresh double-mount) rather than a real duplicate-field bug — it
    self-healed on the existing retry and was not reproducible as a stable
    issue. Recorded here for transparency, not filed as a separate defect.
  - `m3-t4`'s row locator uses `.first()` (newest-first ordering) rather
    than assuming exactly one row per identity — this session's own repeated
    runs of `m3-t3` legitimately created two real "Priya Kapoor"
    registrations, which is expected/desired behavior for a live E2E flow
    test, not a defect, but requires the approval-workflow spec to
    disambiguate correctly.
- No `src/` application code was modified. No regression tests were added to
  `src/__tests__/` (out of scope for live E2E per this task's brief). Three
  temporary one-off admin-SDK verification scripts
  (`_qa_check_form.mjs`, `_qa_check_state.mjs`) were created at the repo root
  to directly inspect Firestore state while debugging, then deleted
  immediately after use — not part of the committed suite.

## How to re-run

```bash
E2E_EMAIL=petricha98@gmail.com E2E_PASSWORD=<redacted> \
  npx playwright test e2e/m3-t1-registration-paths.spec.ts \
    e2e/m3-t2-form-commerce-fields.spec.ts \
    e2e/m3-t3-public-registration-flow.spec.ts \
    e2e/m3-t4-response-approval.spec.ts \
    e2e/m3-t5-abandoned-tracking.spec.ts \
    e2e/m4-t1-t2-page-builder-blocks.spec.ts \
    --project=chromium --reporter=list
```

M3-T1/T2/M4-T1/T2 are idempotent (they detect and reuse existing rows).
**M3-T3 and M3-T5 are NOT idempotent by design** — every run creates a new
real Order/FormData/Attendee (M3-T3) or a new real abandoned draft (M3-T5),
matching this phase's brief to exercise a genuine live registration each
time. Re-running the whole file set is safe but will accumulate additional
real "Priya Kapoor"/"Amara Osei" records — harmless for Phase 3 (which only
needs at least one of each), but worth knowing before re-running casually.

## Final verdict

**SIGNED OFF for Phase 2 with one Major defect open (QA-8) and one
tooling-limitation gap (M4-T1 drag-and-drop) flagged for follow-up.** All
in-scope acceptance criteria for M3-T1 through M3-T5 and M4-T1/M4-T2 pass
via real, live browser interaction against the real Firebase project. QA-8
is a real, confirmed, silent-data-loss-risk defect in the Registration Paths
dialog but does not block Phase 3 (the two real paths Phase 3 needs already
exist and are correctly configured). The M4-T1 drag-and-drop gap does not
block Phase 3 either (Phase 3's scope is M5/M6, not the page builder) but
should be closed before M4 is signed off as fully verified end-to-end. No
Blocker-severity defects were found in this phase's own scope; Phase 1's two
pre-existing Blocker defects (QA-1 signup/session redirect loop, QA-1b its
root cause) remain open and unaffected by this phase's work.
