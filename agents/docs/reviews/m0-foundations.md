# Code Review — M0 Foundations (M0-T1..T4)

Reviewer: Code Reviewer agent, 2026-07-10. Branch `feat/m0-foundations` (uncommitted working tree vs `HEAD`).
Scope: route-group migration + EventShell (M0-T1), starter-cruft cleanup (M0-T2), `firestore.indexes.json` + `baseline.md` (M0-T3), characterization test baseline (M0-T4).

Checks run: `npm run lint` (clean), `npm test` (70 passed — 34 new across 4 files), `npm run build` (compiles; route table verified).

---

## Verdict: **CHANGES REQUESTED**

0 Blockers · 4 Should-fix · 4 Nits. No blockers — the should-fixes are small and must land within this ticket before hand-off to Security.

---

## Findings

### Should-fix

**SF1 — Orphaned chat UI primitives left behind by the cleanup (dead code).**
`src/components/ui/chat/chat-bubble.tsx`, `src/components/ui/chat/chat-input.tsx`, `src/components/ui/chat/chat-message-list.tsx`, `src/components/ui/chat/expandable-chat.tsx`, `src/components/ui/chat/hooks/useAutoScroll.tsx`, `src/components/ui/chat/message-loading.tsx` — after deleting `ChatSupport.tsx` (their only consumer), the only remaining reference is internal (`chat-message-list.tsx:22`). Six dead files contradict the M0-T2 cleanup intent even though they weren't on the spec's delete list. Delete the directory.

**SF2 — Auth gate duplicated across three files; token verified 2–3× per request.**
`src/app/dashboard/(workspace)/layout.tsx:14-29` duplicates the cookie-read + `decodeUser` + `USER_DISABLED`/login redirect block that still lives in `src/app/dashboard/layout.tsx:15-31`, and `src/features/dashboard/server/get-dashboard-scope.ts:16-28` carries a third copy. Every workspace request runs `verifyIdToken` twice (event sub-pages: parent gate + `getDashboardScope` in layout + again in each page). Behavior is currently consistent, but three copies of the disabled-user/expiry policy will drift. Wrap `decodeUser` (or a `getSessionUser` helper) in React `cache()` and have all three call it.

**SF3 — New logic shipped without tests.**
`src/features/event/utils.ts:107` — `getEventBarDateLabel` has 6+ branches (no period, missing date, time-range vs start-only, timezone trim/absent) and zero coverage, in the very ticket that establishes the characterization-test baseline. Add a small unit suite in `src/__tests__/`. (Lower priority: `src/features/event/event-nav.ts:136-149` helpers are also untested.)

**SF4 — Legacy period-key handling inconsistent with the existing label helper.**
`src/features/event/utils.ts:116` reads `firstPeriod.startDate ?? firstPeriod.date` and drops the `start` fallback, while `getEventPrimaryDateLabel` at `src/features/event/utils.ts:85` reads `date ?? start ?? startDate` (opposite precedence, one extra key). A legacy event doc using only `start` (or carrying conflicting `date`/`startDate`) shows a date on the events list but a different/no date in the event bar. Align the candidate list/precedence (or comment why the bar intentionally differs).

### Nit

**N1 — Stale secret declaration.** `apphosting.yaml:19-20` still declares the `GPT_API_KEY` secret for the deleted `/api/chat` route. Spec M0-T2 marked removal optional; remove it anyway.

**N2 — Duplicated initials helper.** `src/features/event/components/event-bar.tsx:31-38` (`getEventInitials`) is a verbatim copy of `getInitials` in `src/features/dashboard/components/dashboard-shell.tsx:134-141`. Extract a shared util when one of them next changes.

**N3 — Preview links Draft events to a 404.** `src/features/event/components/event-bar.tsx:128-137` renders Preview for Draft events, but `/events/[eventId]` gates on `getAdminPublishedEventById`, so drafts open a public 404. This matches the design spec (Preview always; Publish action deferred to M8-T3), so it is only noted — consider a draft-preview mode or disabled state later.

**N4 — Shell remount on Suspense resolve.** `src/app/dashboard/(event)/events/[eventId]/layout.tsx:60` uses a second `<EventShell event={undefined}>` instance as the fallback; when content resolves, the shell remounts (collapse state re-read from localStorage, drawer state reset). Cosmetic flicker only.

---

## Verified good (evidence)

- **Route-group migration is behavior-preserving.** All 20 moved pages/layouts are byte-identical to their committed originals (diffed ignoring CRLF): `(workspace)/{page,events,events/new,forms/**,iam,promotions/**,prototypes/**,responses,settings}` and `(event)/events/[eventId]/{page,edit,form,responses,page-builder/**}`. Only `layout.tsx` + the two groups remain under `src/app/dashboard/`. Build route table shows zero URL changes plus the 8 new placeholder routes (`tickets`, `pricing`, `registration-types`, `registration-paths`, `emails`, `attendees`, `checkin`, `reports`). `/dashboard/events/new` still wins over `[eventId]` (static-over-dynamic), confirmed by build.
- **Auth logic preserved.** The removed `TOKEN_EXPIRED` branch in `src/app/dashboard/layout.tsx` was redundant (fall-through also redirected `/login`). Event routes stay gated by the parent layout + `getDashboardScope`.
- **Page-builder layout reconciled.** `src/app/dashboard/(event)/events/[eventId]/page-builder/layout.tsx` is a pass-through that only imports `puck.css` — no chrome, no double sidebar.
- **Not-found / wrong-org handling.** `(event)/events/[eventId]/layout.tsx:31-33` renders `EventNotFound` (single indistinguishable screen, no name leak) before children mount; sub-pages retain their own `notFound()` guards as defense in depth.
- **Cleanup complete.** Repo grep for `useChatbot|ChatSupport|TodoDoc|createTodo|event-form-test` → 0 hits in `src/`; `/todo`, `/api/chat`, `/api/todos` absent from the build output; `src/lib/db/db.ts` gone.
- **DAL rule holds.** No new `firebase/firestore` / `firebase-admin` imports outside `src/lib/db/` — the two new test files only `vi.mock` those module ids (no real SDK usage). Pre-existing soft exceptions are documented in `agents/docs/data-models/baseline.md`.
- **Indexes match the documented queries.** `firestore.indexes.json` contains exactly the 8 composites tabled in `baseline.md` (EventPage `eventId+organizationId`; Form `eventId+organizationId` and `templateLink.templateId+organizationId`; FormData `organizationId+submittedAt DESC`; Organization `domain+allowDomainAutoJoin` and `inviteCode+inviteCodeEnabled`; the 2 pre-existing EventPromotion CG indexes) with the `organizationId` field override preserved. Spot-checked against `src/lib/db/organization.ts:23-43`, `src/lib/db/adminFormData.ts:19-20`, `src/lib/db/adminForm.ts:147`. Deploy-ahead-of-query-change rationale is documented and sound.
- **Tests assert real behavior.** All 8 spec'd behaviors covered: 5-candidate path fan-out asserted by exact query list, dedupe/sort/schema-drop, Draft-gate on the public read, 3-field floor with exact error message, required/optional text + the optional-email `refine` branch, register-route 404/400 gates with flattened Zod errors, and the happy path asserting the exact `createAdminFormData` payload including the `organizationPath` fallback. DAL mocked at module boundary; no snapshots; `server-only` stubbed via `vitest.config.mts` alias.

## Re-review

Return here after addressing SF1–SF4; approval will be recorded in this file and hands off to the Security Agent.
