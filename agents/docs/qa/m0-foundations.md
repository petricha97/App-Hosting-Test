# QA Report — M0 Foundations (M0-T1..T4)

QA Agent, 2026-07-10. Branch `feat/m0-foundations` (uncommitted working tree).
Inputs: spec `agents/docs/specs/m0-foundations.md`, design `agents/docs/design/m0-event-shell.md`, review `agents/docs/reviews/m0-foundations.md` (CHANGES REQUESTED — SF1–SF4), security `agents/docs/security/m0-foundations.md` (PASS).

## Verdict: **SIGNED OFF**

18/18 acceptance criteria pass. 0 defects of severity Major or above. All 4 review should-fixes verified as landed; all 4 nits also addressed. 3 pre-noted Minor/cosmetic observations carried as non-blocking notes (below). No regression tests were added because no new bug was found.

---

## 1. Automated suite (actually run, 2026-07-10)

| Check | Result | Tail |
|---|---|---|
| `npm run lint` | **PASS** | `✔ No ESLint warnings or errors` |
| `npm test` | **PASS** | `Test Files 6 passed (6) · Tests 95 passed (95) · Duration 1.25s` — register-route (6), domain-utils (36), event-date-labels (25), form-schema (13), admin-published-event (3), event-org-scoping (12) |
| `npm run build` | **PASS** | `✓ Compiled successfully · ✓ Generating static pages (27/27)` + full route table emitted |

Test method note: the dashboard requires a live Firebase session, so interactive flows were verified by static/code-level analysis plus the build route table and the characterization suite; this is recorded per-AC below.

## 2. Review should-fix verification (SF1–SF4)

| Fix | Evidence | Status |
|---|---|---|
| SF1 — delete orphaned `src/components/ui/chat/` | Directory absent (`src/components/ui/chat`, `src/components/chat` both gone); git status shows all 6 files deleted | **Fixed** |
| SF2 — shared session gate | `src/lib/session.ts`: `getSessionUser` wrapped in React `cache()`, `requireSessionUser` owns login/disabled policy; all 3 former copies (`dashboard/layout.tsx:12`, `(workspace)/layout.tsx:11`, `get-dashboard-scope.ts:14`) now call it — `verifyIdToken` runs once per request | **Fixed** |
| SF3 — tests for `getEventBarDateLabel` | `src/__tests__/event-date-labels.test.ts` — 25 tests covering all branches (no periods, no date, time range, start-only, end-without-start, snake_case keys, timezone trim/absent, first-period-only) + `getInitials` | **Fixed** |
| SF4 — period-key precedence drift | `src/features/event/utils.ts:84` — single `resolvePeriodSchedule` (`date ?? start ?? startDate`, camel/snake time keys) used by both `getEventPrimaryDateLabel` and `getEventBarDateLabel`; alignment locked by the `period-key alignment between list and event-bar labels` describe block | **Fixed** |

Nits also verified fixed: N1 `GPT_API_KEY` removed from `apphosting.yaml` (repo grep: only agent docs mention it — also closes SEC-M0-5); N2 `getInitials` extracted to `src/lib/utils.ts:11` and shared by dashboard-shell + event-bar.

## 3. AC-by-AC results

### M0-T1 — Event workspace shell (9 ACs)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Existing sub-routes render in shell; zero URL changes; no double sidebar | **PASS** | All 5 pre-existing routes (`page.tsx`, `edit/`, `form/`, `responses/`, `page-builder/`) live under `src/app/dashboard/(event)/events/[eventId]/` wrapped by `layout.tsx` → `EventShell`. Build route table: identical URLs (route groups strip from paths); `/dashboard/events/new` still wins over `[eventId]`. `page-builder/layout.tsx` is a pass-through importing only `puck.css` — no second chrome |
| 2 | Sidebar groups/items/order exact; active highlight; labels non-interactive | **PASS** | `src/features/event/event-nav.ts` matches the spec table exactly (Event/Build/Registration/Engage & Manage; Responses last per spec decision 1). Active: `exact` for Overview, prefix otherwise, `bg-primary/10` + `aria-current="page"`. Group labels are plain `<p>` elements |
| 3 | "← All events" → `/dashboard/events` preserving org scope | **PASS** | `event-nav-sidebar.tsx:33` links `/dashboard/events`; org scope is server-derived from the caller's User doc (`getDashboardScope`), never URL-carried — nothing to lose |
| 4 | Event bar: title, meta (graceful omission), status badge | **PASS** | `event-bar.tsx`: h1 + breadcrumb; meta renders dateLabel/venue/code with separators emitted only between present segments; `StatusBadge` — Published emerald + dot, Draft secondary + dot, driven by the `"Draft" | "Published"` casing |
| 5 | 8 coming-soon routes load placeholder in shell, milestone-tagged, no 404 | **PASS** | Build table lists all 8 (`tickets`, `pricing`, `registration-types`, `registration-paths`, `emails`, `attendees`, `checkin`, `reports`); each stub renders `ComingSoonSection` (icon, "{Title} is coming soon", description, `Coming in {M#}` badge, back-to-overview) inside the layout, with per-page `metadata.title` |
| 6 | Not found / wrong org fires from layout before sub-page renders | **PASS** | `(event)/events/[eventId]/layout.tsx:31-33` — `getAdminEventForOrganization` null → `EventNotFound` returned instead of children. Sub-pages keep their own `notFound()` guards (defense in depth). Locked by `event-org-scoping.test.ts` (missing event, wrong org, schema-fail → null; all 5 legacy path variants → event) |
| 7 | Loading skeleton; permission-denied never leaks event name | **PASS** | Suspense fallback = `EventShell` with `event={undefined}` → bar + main skeletons, sidebar immediate (needs only `eventId`). Missing vs wrong-org render the identical `EventNotFound` card; the fallback shows only the attacker-supplied eventId, no data. Matches security report item 3 |
| 8 | Both themes; ≤768px sidebar collapses, content reachable | **PASS** (static) | All new shell components use semantic tokens (`bg-card`, `border-border`, `text-muted-foreground`); grep for hardcoded slate/white/gray in `src/features/event/components/` hits only the intentional brand-gradient avatar fallback (`text-white` on `#ffb082→#ff7a59`, per design §2.1); status badge has explicit `dark:` variants and text labels (not color-only). `<lg`: aside hidden, Menu button opens `Dialog` drawer (`w-[88vw] max-w-[19rem]`, sr-only title, close button, closes on navigate). Not visually exercised — dashboard requires live auth |
| 9 | Overview quick-actions deep-link to shell routes | **PASS** | `organization-event-detail.tsx:171-184, 350-364` → `edit`, `page-builder`, `form`, `responses` — all real shell routes in the build table |

A11y spot-checks (design §7): `<nav aria-label="Event sections">`, `role="group"` + `aria-labelledby` per group, `aria-current="page"`, sr-only "(coming soon)" inside Soon links, `focus-visible:ring` on nav rows and breadcrumb link, bar is `<header>`, content in `<main>`, event code `aria-label`. All present.

### M0-T2 — Starter-cruft cleanup (3 ACs)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | All 8 items deleted; layout.tsx no longer imports ChatSupport | **PASS** | git status: `api/chat/route.ts`, `api/todos/route.ts`, `todo/page.tsx`, `ChatSupport.tsx`, `useChatbot.ts`, `lib/db/db.ts`, `event-form-test.tsx` all D; `src/app/layout.tsx` modified; `TodoDoc` gone from `src/types/collection.ts` (grep: 0 hits) |
| 2 | build/lint/vitest pass; `/todo`, `/api/chat`, `/api/todos` 404 | **PASS** | Suite green (§1); none of the three routes appear in the build route table → Next serves 404 |
| 3 | Repo grep `useChatbot|ChatSupport|TodoDoc|createTodo|event-form-test` = 0 in `src/` | **PASS** | Ran grep (incl. `lib/db/db`, `api/chat`, `api/todos`): zero hits |

### M0-T3 — Firestore query inventory (3 ACs)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Every query indexed or auto-justified in baseline.md | **PASS** | `agents/docs/data-models/baseline.md` tables every query per collection with auto/merge/composite disposition; `firestore.indexes.json` parses as valid JSON and contains exactly the 8 composites tabled (EventPage #1, EventPromotion CG #2–3, Form #4–5, FormData #6, Organization #7–8) + the `organizationId` field override — 1:1 with the baseline coverage table |
| 2 | Unbounded reads #1/#2/#6/#8 flagged with follow-up | **PASS** | R1 (cross-org Published scan), R2 (pagination policy: default limit 50 + cursor, `getAll` removal), R3 (5-way path fan-out) recorded as follow-up recommendations with concrete query+index changes |
| 3 | Smoke of events/forms/responses/promotions lists: no missing-index errors | **PASS** (analytical) | No emulator config or CI credentials exist in-repo; verified statically instead: every query the current code executes is single-equality (auto-indexed) or one of the two pre-existing EventPromotion CG composites already in `firestore.indexes.json` (in production use per commit history). The 6 new composites are additive and deliberately deployed ahead of the query changes they enable — no current query shape can raise `failed-precondition: missing index` |

### M0-T4 — Test baseline (3 ACs)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | All 8 behaviors have failing-first assertions, no snapshots | **PASS** | Behaviors 1–2: `event-org-scoping.test.ts` (null for missing/wrong-org/schema-fail, `it.each` over all 5 legacy path variants, 5-candidate query fan-out asserted by exact query list, dedupe, `updatedAt.seconds` desc sort, silent schema drop). 3: `admin-published-event.test.ts` (Draft → null despite existing doc). 4–6: `form-schema.test.ts` (3-field floor both schemas, required text `"{label} is required"` + whitespace, optional default `""`, required/optional email incl. the optional-nonempty-malformed refine branch). 7–8: `register-route.test.ts` (404 missing/Draft, 404 no published form, 400 non-record + schema-fail with flattened Zod errors; happy path asserts exact `createAdminFormData` payload incl. `organizationPath` fallback). Grep `toMatchSnapshot|toMatchInlineSnapshot`: 0 |
| 2 | DAL mocked at module boundary, no emulator | **PASS** | Tests `vi.mock` `@/lib/db/*`; `server-only` stubbed via `vitest.config.mts` alias (`src/__tests__/stubs/`); no Firebase SDK usage in tests |
| 3 | Green alongside `domain-utils.test.ts` via `npm test` | **PASS** | 6 files / 95 tests green in one run (§1) |

## 4. Defects

**None opened.** No Major-or-above defects found; no regression tests required.

Non-blocking observations (carried forward, already known):
1. **(Minor, cosmetic — fullstack-developer, backlog)** Review N4: Suspense fallback uses a second `<EventShell>` instance, so the shell remounts when content resolves (collapse state re-read, drawer reset). Flicker only.
2. **(Minor, UX — ui-ux-designer, revisit at M8-T3)** Review N3: Preview on a Draft event opens the public route, which 404s (public gate is `getAdminPublishedEventById`). Matches the current design spec, but a draft-preview mode or hint should land with Publish work.
3. **(Cosmetic — ui-ux-designer, no ticket needed)** Breadcrumb on the page-builder route reads `Events / {name} / Website / Pages` — the nav title's internal slash is visually ambiguous with breadcrumb separators. Consider "Website" or an en-dash title if it bothers anyone.
4. Security follow-ups SEC-M0-1..4 remain open as pre-existing tracked debt (Backend Agent M8-T1 / Developer dependency ticket) — outside this ticket's gate per the security report. SEC-M0-5 is now resolved (verified in §2).

## 5. Regression tests added

None — regression tests are written only for bugs found, and none were found. The 34 new characterization tests (developer-authored, M0-T4) were executed and verified to assert the spec'd behaviors.

## 6. Sign-off

All 18 acceptance criteria pass; automated suite green (lint / build / 95 tests); review should-fixes and nits verified landed; security verdict PASS with no Critical/High introduced. **SIGNED OFF** — Orchestrator may close M0-T1..T4.
