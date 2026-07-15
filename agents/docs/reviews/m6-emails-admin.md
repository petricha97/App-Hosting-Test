# Code Review — M6-T2 Emails admin screen

Code Reviewer, 2026-07-14. Scope: all uncommitted changes in the working
tree relative to `prototype` that belong to M6-T2 — new `src/lib/db/{adminEmailDefinition,emailDefinitionId}.ts`
(Backend DAL), new `src/features/emails/**` (16 components + `server/*` +
`default-definitions.ts`/`schemas.ts`/`types.ts`/`utils.ts`, Full-Stack), new
`src/app/api/dashboard/events/[eventId]/emails/**` (7 routes), new
`.../emails/loading.tsx`, modified `.../emails/page.tsx`,
`src/features/event/event-nav.ts`, `src/lib/email/schemas.ts`,
`src/types/collection.ts`, the M6-T2-flagged addition
`deleteAdminEmailSettings` in `src/lib/db/adminEmailSettings.ts`, the L-5
carried-polish fix (`src/features/checkin/server/resolve-scan.ts` + the two
public checkin routes), `firestore.indexes.json` / `firestore.rules`, and
all new/extended test files. Reviewed against
`agents/docs/specs/m6-emails-admin.md`, `agents/docs/design/m6-emails-admin.md`,
`agents/docs/data-models/m6-emails-admin.md`, and `agents/AGENT_LOOP.md`'s
Code Reviewer checklist. (`HANDOVER.md`, `agents/docs/BACKLOG.md`, `memory/`
excluded — orchestration bookkeeping, not code, matching the M6-T1 review
precedent.)

Checks executed this session:
- `npm run lint` — ✅ exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — ✅ clean except 3 **pre-existing,
  unrelated** errors (`attendees-roster.test.ts:106/160/221`,
  `event-org-scoping.test.ts:152-154`, `register-route.test.ts:51`) —
  verified these are outside the M6-T2 diff and match the expected baseline.
- `npm run build` — ✅ exit 0; all 7 new email API routes and the emails
  page compile and appear in the route manifest.
- `npm test -- --run` — ✅ **89 files / 1164 tests passing**, including all
  11 new/extended M6-T2 suites and `checkin-l5-organizer-label.test.ts`.

---

## Mandatory-check results

1. **DAL boundary — PASS.** `grep` for `firebase-admin/firestore` /
   `firebase/firestore` / `@/app/lib/firestore` across `src/features/emails/**`
   and `src/app/api/dashboard/events/[eventId]/emails/**` returns zero hits.
   The only new Firestore-touching code lives in
   `src/lib/db/adminEmailDefinition.ts` and the `deleteAdminEmailSettings`
   addition to `src/lib/db/adminEmailSettings.ts`. `src/lib/db/emailDefinitionId.ts`
   is pure `node:crypto` (same family as `emailMessageId.ts`). The extended
   `email-import-boundary.test.ts` now also asserts every module under
   `src/features/emails/server/` is `"server-only"` and touches no Firestore
   directly — genuinely enforced (verified by reading the test, not just
   trusting its name).

2. **Cross-boundary DAL addition (`deleteAdminEmailSettings`) — PASS, correctly
   flagged and reviewed.** `src/lib/db/adminEmailSettings.ts:117-151`. Doc id
   convention matches the sibling `getAdminEmailSettingsForEvent`/
   `upsertAdminEmailSettings` (doc id = `eventId`), tenancy is re-checked
   before delete (`CROSS_ORG` → zero writes), missing-doc delete is a
   harmless idempotent no-op, and the choice (delete-doc vs. sentinel) is
   documented in-code with the rationale the data-model doc promised
   ("BE picks delete-doc vs sentinel, documented in the data model"). Real
   tests in `admin-email-settings-delete.test.ts` cover all three branches
   including the "doc survives" assertion on the cross-org path
   (`admin-email-settings-delete.test.ts:76-90`). The route
   (`.../emails/settings/route.ts:133-163`) correctly re-gates
   `write:events` before calling it and returns the freshly-resolved
   read-time defaults afterward. No issues.

3. **Render-pipeline XSS claim — VERIFIED against `merge-tags.ts`, not just
   trusted.** `src/features/emails/server/render.ts:28-34`
   (`deriveBodyHtmlTemplate`) calls `escapeHtml` from `merge-tags.ts` on the
   **whole template first** (including any literal `<script>` an organizer
   types), then wraps it in `<p>`/`<br>`. `escapeHtml`
   (`src/lib/email/merge-tags.ts:105-112`) escapes `&<>"'` only — lowercase
   letters, digits, underscore, and `{`/`}` are untouched, so `{tag}` tokens
   survive the escape intact and `renderEmailTemplate`'s `TAG_RE`
   (`merge-tags.ts:141`) can still find and substitute them. The `html` part
   of `renderPart` (`merge-tags.ts:198`) additionally escapes each
   **substituted value** on the way in, so a merge-tag value containing
   `<script>` is independently safe. The construction is airtight: the base
   template is escaped once by the caller, substituted values are escaped
   again by the renderer, `{qr_code}` is the one exception and its
   replacement is server-minted trusted SVG (never user input, per T1). This
   is the same claim T1's review verified for the renderer itself; T2 wires
   it up correctly. `email-render-pipeline.test.ts` exercises the real
   `<script>` case end-to-end through `renderEmailDefinitionPreview` and
   asserts both the escaped HTML and the verbatim plain-text variant — not a
   trivial unit test, a genuine regression lock.

4. **Route permission gating — PASS, all 7 routes verified individually.**
   Every one of `definitions/route.ts` (GET/POST), `definitions/[kind]/route.ts`
   (PATCH/DELETE), `messages/route.ts` (GET), `messages/[messageId]/retry/route.ts`
   (POST), `preview/route.ts` (POST), `settings/route.ts` (GET/PATCH/DELETE),
   and `test-send/route.ts` (POST) calls `resolveRegistrationRouteScope`
   first, before touching any DAL function, and returns its `status` verbatim
   on failure. Per spec §7 (and the M5 L-4 convention it names), **every**
   T2 API route — including the reads (definition list, send-log list,
   settings GET) — gates on `write:events`, not just org membership; the
   server **page** (`.../emails/page.tsx`) is the only read surface gated on
   org membership alone. This is a deliberate, spec-mandated divergence from
   a generic "reads=membership, writes=write:events" split, and the code
   matches the spec exactly. Confirmed via route-matrix tests in
   `email-definitions-route.test.ts`, `email-messages-route.test.ts`,
   `email-settings-route.test.ts`, `email-test-send-route.test.ts` — each
   asserts both a 403-without-`write:events` case and a 404-cross-org case,
   and that the underlying DAL/service function is never called on either
   failure path.

5. **L-5 checkin masking — PASS, correctly scoped in both directions.**
   `checkedInByName`/`serializeScanAttendeeCard`
   (`src/features/checkin/server/resolve-scan.ts:82-112`) take an optional
   `viewerIsTeamSession` parameter defaulting to `false` (unmasked). The two
   **public, team-session** routes
   (`src/app/api/events/[eventId]/checkin/{confirm,resolve}/route.ts`) both
   pass `true` explicitly on every call site. The two **dashboard-admin**
   routes (`src/app/api/dashboard/events/[eventId]/checkin/{confirm,resolve}/route.ts`)
   are untouched by this diff and call both functions with **no** second
   argument — they correctly keep the default `false` (unmasked), so an
   admin viewing their own dashboard still sees real names/emails, exactly
   as required. `checkin-l5-organizer-label.test.ts` locks this at three
   layers: the pure function, `serializeScanAttendeeCard`, and a full
   route-level test that mocks the public confirm/resolve routes end-to-end
   and asserts `JSON.stringify(body)` never contains the admin's email.

6. **Types / structure / duplication — PASS with one Should-fix (file size)
   and minor nits below.** No unjustified `any` found anywhere in the new
   code (`grep -rn ": any\b\|as any\b"` across `src/features/emails/**` and
   the new DAL/route files returns nothing). Typed result unions
   (`UpsertAdminEmailDefinitionResult`, `DeleteAdminEmailDefinitionResult`,
   `DeleteAdminEmailSettingsResult`) follow the T1 convention exactly. The
   merge-tag catalog is genuinely never forked — `EMAIL_MERGE_TAG_DISPLAY`
   (the client-safe copy needed because `merge-tags.ts` is `"server-only"`)
   is locked in lockstep with `EMAIL_MERGE_TAGS` by a real test
   (`email-utils.test.ts:82-94`), not just a comment promise. No dead code
   found — every exported function has a route/component/test consumer.
   `email-editor-dialog.tsx` is **818 lines**, over the repo's 800-line hard
   cap and roughly 2x the size of comparable dialogs elsewhere in the app
   (`ticket-type-dialog.tsx` is 406 lines) — see S-1.

7. **Tests assert real behavior — PASS**, with one required-but-missing
   regression test — see S-2. Every new suite reviewed
   (`admin-email-definition.test.ts`, `email-definition-id.test.ts`,
   `email-default-definitions.test.ts`, `email-render-pipeline.test.ts`,
   `email-definitions-route.test.ts`, `email-messages-route.test.ts`,
   `email-test-send-route.test.ts`, `email-settings-route.test.ts`,
   `email-utils.test.ts`, `admin-email-settings-delete.test.ts`,
   `checkin-l5-organizer-label.test.ts`) asserts stored state, write counts,
   HTTP status codes, and response bodies against real fakes/mocks — not
   snapshots of nothing. The 100-per-event cap, locked-field rejection,
   create-if-absent race replay, cross-org/cross-event IDOR-safety (both DAL-
   and route-level, including a genuine two-org route test at
   `email-definitions-route.test.ts:441`), and the double-click dedupeKey
   test-send behavior are all exercised with real assertions.

**Data-model doc vs. code:** accurate throughout — collection shape,
deterministic id derivation, editability matrix, `upsertAdminEmailDefinition`
call shapes, 100-per-event cap placement, delete semantics, and index/rules
registration all match the code exactly.

---

## Findings

### Blockers

None.

### Should-fix (fix in this ticket)

- **S-1 — `email-editor-dialog.tsx` is 818 lines, over the repo's 800-line
  file cap** (`src/features/emails/components/email-editor-dialog.tsx:1-819`).
  It's roughly double the size of the closest comparable dialog in this app
  (`src/features/registration/components/ticket-type-dialog.tsx`, 406
  lines). It's functionally correct and well-organized internally (the file
  already extracts `LockedRow` and `TriggerFields` as local helper
  components at the bottom), but it still owns compose-form rendering,
  live-preview debounce/fetch, save, test-send, and the discard-confirm
  dialog in one file. Extract at least the test-send row
  (`testSendOpen`/`testSendPending`/`testSendResult` state + its two JSX
  blocks) and `TriggerFields`/`LockedRow` into
  `src/features/emails/components/email-editor-*.tsx` siblings — this drops
  the file comfortably under 800 lines and matches the "many small files"
  convention the rest of this feature module follows (every other new file
  here is under ~450 lines).
- **S-2 — Spec §5 AC-8 ("QA-1 promotion") is not fulfilled: the cross-org/
  cross-event same-dedupeKey `EmailMessage` regression test was not added to
  the permanent suite.** The spec is explicit: *"the row-level cross-org/
  cross-event same-dedupeKey test (same dedupeKey/kind/recipient across
  org-2/event-2 → separate rows + transport calls; same-tuple control → one
  row) enters the permanent suite in this ticket"* — this was elevated from
  a T1 QA "Minor, non-gating suggestion" to an explicit T2 acceptance
  criterion. `src/__tests__/email-send-service.test.ts` (the T1 file this
  test would live in) is untouched by this diff (`git status` confirms no
  modification), and no other new test file in this diff contains it —
  `grep -rn "org-2.*dedupeKey\|dedupeKey.*org-2"` across `src/__tests__`
  returns nothing for `EmailMessage`. The underlying *property* is well
  covered indirectly (`email-message-id.test.ts` proves a different org
  yields a different hash id; `admin-email-message.test.ts:236-309` proves
  cross-org reads/writes 404/NOT_FOUND with zero writes), but the specific
  end-to-end regression the spec calls out by name — same tuple except
  org/event → two separate rows *and* two separate transport calls — is
  missing from the permanent suite. Low risk (the property follows
  mechanically from the id derivation already tested), but it's a named,
  explicit AC that isn't met; add it to `email-send-service.test.ts` before
  closing the ticket.

### Nits (optional)

- **N-1** — `src/features/emails/default-definitions.ts` has no direct
  `import "server-only";` of its own; its doc comment (`:7-13`) correctly
  notes it is only *transitively* server-only via its `merge-tags.ts`
  import, and the extended import-boundary test only requires
  `"server-only"` on `src/lib/email/*` and `src/features/emails/server/*`
  (not top-level `src/features/emails/*.ts`). No client component imports
  it (verified — every consumer is `page.tsx` or an API route), so there's
  no live risk, but an explicit `import "server-only";` here would make the
  guarantee self-enforcing rather than relying on the transitive chain plus
  reviewer vigilance, and would cost nothing.
- **N-2** — `upsertAdminEmailDefinition`'s `LOCKED_FIELDS` result names the
  DAL field `"trigger"` (`src/lib/db/adminEmailDefinition.ts:256`), but the
  editor's RHF schema has no `trigger` field — it's split into `triggerType`
  and `scheduledAt` (`src/features/emails/schemas.ts:37-39`). If a
  `LOCKED_FIELDS` response ever named `"trigger"` in practice,
  `applyApiFormError` would call `form.setError("trigger", …)`, which
  wouldn't bind to any rendered `FormField` and would silently fail to
  surface. Currently unreachable — system-definition trigger-type changes
  are never offered by the UI (locked fields render as read-only
  `LockedRow`s, not editable controls) — so this is latent, not live.
  Worth a one-line mapping (`trigger` → `triggerType`) in
  `applyApiFormError`'s call site or a field-name alias if the editor ever
  grows a path to submit trigger-type changes for a system row.
- **N-3** — `src/features/registration/server/route-scope.ts:54-58`'s doc
  comment ("Every consumer of this helper is a mutating route
  (POST/PATCH/DELETE)") was already inaccurate before this diff (several
  pre-existing GET routes, e.g. `attendees/route.ts`, `drafts/route.ts`,
  already reuse it for reads) and remains so now that all 7 email GET/POST/
  PATCH/DELETE routes share it too. Not introduced by this diff and the
  file isn't touched here, but flagging since M6-T2 adds three more GET
  consumers — worth a stale-comment cleanup pass whenever that file is next
  touched.

---

## Verdict

| Ticket | Verdict | Notes |
|---|---|---|
| M6-T2 — Emails admin screen | **APPROVED** | No blockers. S-1 (file-size split) and S-2 (missing spec-mandated regression test) should land before/alongside Security review but do not gate correctness — the underlying logic, DAL boundary, XSS-by-construction claim, permission gating, and L-5 masking scope are all independently verified against real tests, not just trusted from comments. |

Overall: **APPROVED** — hands off to the Security Agent. S-1 and S-2 are
inexpensive and should be closed in this ticket (ideally before Security
review, since S-2 is a named acceptance criterion), but neither blocks the
handoff. Also noting, per the Orchestrator's brief, the Full-Stack
Developer's **self-reported gaps** for QA to specifically close: no
component-level interaction tests (RHF form behavior, optimistic
toggle/rollback UI, discard-guard dialog), no visual/responsive
verification (320/768/1024/1440, both themes), and cross-org tests that are
route-level DAL-mocked rather than fresh two-org fake-Firestore seeds for
the API layer (the DAL layer itself *does* have fresh two-org fake-Firestore
tests in `admin-email-definition.test.ts`). None of these block Code Review
approval — they're QA's job — but they should not be lost before QA signs
off.

---

## Re-review — S-1/S-2 fix verification

Code Reviewer, 2026-07-15. Scope: **only** the S-1 and S-2 fix diffs, per
this loop's re-entry convention — the rest of the M6-T2 diff was already
fully reviewed and approved above and has not changed.

### S-1 — file-size split — PASS

- `src/features/emails/components/email-editor-dialog.tsx` is now **592
  lines** (was 818), comfortably under the 800-line cap.
- Three new sibling files, correctly named to match this feature module's
  `email-editor-*` / kebab-case convention (compare
  `email-group-table.tsx`, `send-log-table.tsx`, etc.):
  - `src/features/emails/components/email-editor-locked-row.tsx` (30
    lines) — `EmailEditorLockedRow`, an exact lift of the old inline
    `LockedRow` helper (label + `LockKeyhole` icon + value), with an
    in-file comment noting the extraction and "no behavior change."
  - `src/features/emails/components/email-editor-trigger-fields.tsx` (123
    lines) — `EmailEditorTriggerFields`, an exact lift of the old inline
    `TriggerFields` helper; same three branches (system+scheduled editable
    datetime, system+manual locked row, custom manual/scheduled select +
    conditional datetime field), same field names (`scheduledAt`,
    `triggerType`), same `timeZone` display string.
  - `src/features/emails/components/email-editor-test-send.tsx` (224
    lines) — extracts the `useEmailEditorTestSend` hook (owns
    `testSendOpen`/`testSendPending`/`testSendResult`/`testSendForm` state
    and `handleTestSend`) plus two presentational pieces,
    `EmailEditorTestSendRow` (inline recipient form / result line, rendered
    above the footer) and `EmailEditorTestSendButton` (footer trigger,
    disabled+tooltip when `!enabled`). The hook's own `open`/`definition`
    reset effect reproduces the dialog's original single reset effect
    (verified: same reset shape — `testSendForm.reset`, `setTestSendOpen`,
    `setTestSendResult`, gated on `open`, same dependency array modulo the
    documented `eslint-disable` line carried over unchanged).
- Wiring verified in `email-editor-dialog.tsx`: `EmailEditorLockedRow` is
  imported and used at the three former `LockedRow` call sites
  (`:333`, `:368`, `:415`); `EmailEditorTriggerFields` replaces the former
  inline `TriggerFields` block (`:374`); `useEmailEditorTestSend` is called
  once (`:152`) and its returned state is threaded into
  `EmailEditorTestSendRow` (`:516`, above the footer — same position as
  before) and `EmailEditorTestSendButton` (`:520`, inside
  `DialogFooter`'s left slot — same position as before).
  `grep -n "testSendOpen\|testSendPending\|testSendResult\|LockedRow\|TriggerFields"` against `email-editor-dialog.tsx` shows zero
  leftover inline definitions — nothing was duplicated, nothing orphaned.
  `grep -rl` for the three new export names across `src/` shows each is
  used only inside its own file plus `email-editor-dialog.tsx` (and
  `email-editor-trigger-fields.tsx` importing
  `EmailEditorLockedRow`) — no dead/unused sibling files.
- Read the full reduced dialog file end to end: `buildDefaultValues`,
  `buildTriggerPayload`, the debounced live-preview effect, `attemptClose`,
  `onSubmit` (create vs. patch branching, `LOCKED_FIELDS` handling via
  `applyApiFormError`), and the discard-confirm `AlertDialog` are all
  present, unchanged in logic, and reference the extracted components
  correctly. This is a clean, behavior-preserving structural refactor —
  no logic was altered in the split.

### S-2 — missing regression test — PASS

- `src/__tests__/email-send-service.test.ts:248-301` now contains
  `describe("cross-org/cross-event dedupeKey scoping (M6-T2 spec §5 AC-8,
  promoted from T1 QA-1)", …)` with one test that:
  - Runs a **same-tuple control** first: identical `(org-1, evt-1,
    dedupeKey: "submission-1")` sent twice → asserts `controlFirst.outcome
    === "sent"`, `controlSecond` matches `{ ok: true, outcome:
    "duplicate" }`, `transport.send` called exactly once, exactly one
    stored row (`:256-261`).
  - Then sends the **same** `dedupeKey`/`kind`/recipient but with
    `organizationId: "org-2"` and `eventId: "evt-2"` → asserts
    `crossTenant.outcome === "sent"` (not `"duplicate"`), `transport.send`
    now called **twice** total, **two** stored rows total (`:266-276`),
    and explicitly asserts the two rows' `organizationId`/`eventId` values
    via `expect.arrayContaining` (`:278-299`) so the test can't pass by
    accident (e.g. via a coincidental doc-count match) — it verifies both
    rows actually carry the distinct org/event values.
  - This genuinely distinguishes "dedupe within tenant" from "no dedupe
    across tenant" — the control proves dedup is active for the exact same
    tuple, and the cross-tenant case proves it stops applying the moment
    org/event differ, which is exactly what AC-8 requires (not a
    tautological assertion).
  - Uses the file's existing fake-transport (`stubTransport()`) /
    fake-admin-db (`createFakeAdminDb()`, `storedMessages()`) pattern
    correctly and consistently with every other test in the file — no new
    test infrastructure introduced.

### Checks re-run this session

- `npm run lint` — clean, no warnings or errors.
- `npx tsc --noEmit --pretty false` — clean except the same 3
  pre-existing, unrelated errors at the same lines
  (`attendees-roster.test.ts:106,160,221`, `event-org-scoping.test.ts:152-154`,
  `register-route.test.ts:51`).
- `npm run build` — succeeds; `/dashboard/events/[eventId]/emails` and all
  7 email API routes still compile and appear in the route manifest.
- `npm test -- --run` — **89 files / 1165 tests passing** (exactly one more
  test than the prior 1164, matching the single new S-2 regression test;
  no other test count changed).

### Updated verdict

| Ticket | Verdict | Notes |
|---|---|---|
| M6-T2 — Emails admin screen | **APPROVED** | Both Should-fix items (S-1 file-size split, S-2 missing spec-mandated regression test) are correctly and completely resolved. S-1 is a clean, verified-behavior-preserving extraction into three correctly-wired, conventionally-named sibling files; the dialog is now 592 lines. S-2 adds exactly the named regression test the spec required, with a real same-tuple control that proves the test discriminates rather than trivially passing. No new issues introduced by either fix. The 3 optional Nits from the original review remain out of scope and unresolved, as expected. |

Overall: **APPROVED** — hands off to the Security Agent.
