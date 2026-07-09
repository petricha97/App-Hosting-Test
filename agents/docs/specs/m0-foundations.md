# M0 — Foundations Spec (M0-T1..T4)

Research Lead, 2026-07-09. Inputs: `prototype/prototype/event-overview.html`, `event-tickets.html`, `_code-audit.md`, `_screen-inventory.md`, direct code reads. Status values in code are `"Draft" | "Published"` (Event) — keep this casing.

---

## M0-T1 — Event workspace shell

### User stories
- As an **event organizer**, opening an event puts me in a dedicated event workspace with grouped navigation to every event capability, so I never lose context switching between pages/form/tickets.
- As an **org admin**, I can jump back to the all-events list in one click from anywhere in the event workspace.

### Nav taxonomy (exact, from every `event-*.html` sidebar)
| Group label | Item | Route under `src/app/dashboard/events/[eventId]/` | Today |
|---|---|---|---|
| (top link) | ← All events | `/dashboard/events` | exists |
| Event | Overview | `page.tsx` | exists (`organization-event-detail.tsx`) |
| Build | Website / Pages | `page-builder/` | exists (has own `layout.tsx` — must nest or merge into the shell) |
| Build | Registration Form | `form/` | exists |
| Registration | Ticket Types | `tickets/` | **placeholder until M1-T2** |
| Registration | Pricing | `pricing/` | **placeholder until M2-T1** |
| Registration | Registration Types | `registration-types/` | **placeholder until M1-T1** |
| Registration | Registration Paths | `registration-paths/` | **placeholder until M3-T1** |
| Engage & Manage | Emails | `emails/` | **placeholder until M6-T2** |
| Engage & Manage | Attendees | `attendees/` | **placeholder until M5-T2** |
| Engage & Manage | Check-in | `checkin/` | **placeholder until M5-T4** |
| Engage & Manage | Reports | `reports/` | **placeholder until M7-T1** |
| Engage & Manage | Responses *(app-only, interim)* | `responses/` | exists |

Decisions:
1. **Responses placement:** the prototype Event shell has no Responses item (only workspace-level `responses.html`). Keep the existing per-event `responses/` route and surface it as the last item of **Engage & Manage** (it is a manage-attendee activity and the future data source for Attendees). Revisit at M3-T4/M5-T2; do not delete the route.
2. **`edit/` route** is not a nav item. It renders inside the shell; entry points are Overview's "Edit details" action and the event bar (title area is not a link). Breadcrumb: `Events / {event name} / Edit`.
3. **Placeholders:** unbuilt items are enabled links (not disabled) rendering a shared "Coming soon" card (feature name, one-line description, milestone tag). They must be real routes so deep links from Overview quick-actions don't 404.
4. **Status-driven states:** nav items are never disabled by event status. Draft vs Published affects only (a) event-bar badge (amber dot "Draft" / green dot "Published"), (b) topbar actions — Draft: `Preview` + `Publish`; Published: `Preview` + `Publish changes`. Existing status-toggle API `POST /api/dashboard/events/[eventId]/status` backs this.
5. **Shell composition:** new `src/app/dashboard/events/[eventId]/layout.tsx` replaces the workspace sidebar (`src/features/dashboard/dashboard-shell.tsx` + `nav.ts`) for event sub-routes. Workspace shell remains untouched everywhere else.

### Event bar (from `event-overview.html` lines 44–52)
Logo tile (event/org logo, fallback = initials block) · title (h2) · meta line `date, time range · timezone | venue | <mono>event code</mono>` (each segment omitted if missing) · right-aligned status badge. Topbar above it: breadcrumb `Events / {event name}` + action buttons.

### Acceptance criteria
1. Every existing sub-route (`page.tsx`, `edit/`, `form/`, `responses/`, `page-builder/`) renders inside the new shell with sidebar + event bar; zero URL changes; no double-sidebar (page-builder's own layout reconciled).
2. Sidebar shows exactly the groups/items/order in the table above; active item highlighted; group labels non-interactive.
3. "← All events" navigates to `/dashboard/events` preserving the active org scope.
4. Event bar shows title, date/venue/code meta (gracefully omitting missing fields), and correct status badge for Draft and Published events.
5. The 8 unbuilt nav items each load a "Coming soon" placeholder page inside the shell (no 404, no blank page), tagged with its milestone.
6. Event not found / wrong org → the existing not-found handling (redirect or 404) still fires from the layout, before any sub-page renders.
7. Loading state: shell chrome (sidebar + bar skeleton) renders while event data loads; permission-denied (event of another org) never leaks event name.
8. Works in both themes and at ≤768px (sidebar collapses per UX design; content remains reachable).
9. Overview quick-action deep links point at the shell routes (placeholder or real).

### Gap analysis
No event-level layout exists today — event pages render inside the workspace shell (`dashboard-shell.tsx`, `nav.ts`: Overview/Events/Forms/Responses/Promotions/Users/Settings). `page-builder/layout.tsx` is the only sub-layout and will conflict with the new shell if left as-is.

---

## M0-T2 — Starter-cruft cleanup

Grep confirmed (2026-07-09): **nothing in the app references the cruft except the cruft itself, with one exception — the chat widget chain is mounted in the root layout.**

Delete list (all under `C:\Users\Admin\Desktop\dev\App-Hosting-Test\`):
1. `src/app/api/chat/route.ts` — OpenAI proxy (uses `GPT_API_KEY` env; no npm dep involved).
2. `src/components/chat/ChatSupport.tsx` — sole caller of the hook below; **imported and mounted in `src/app/layout.tsx` (lines 7, 31) — remove that import + JSX**.
3. `src/hooks/useChatbot.ts` — only used by ChatSupport; fetches `/api/chat`.
4. `src/app/api/todos/route.ts` — imports `createTodo` from `src/lib/db/db.ts`.
5. `src/app/todo/page.tsx` — fetches `/api/todos`; no link/href to `/todo` anywhere in `src/`.
6. `src/lib/db/db.ts` — todo-only DAL; only importer is the todos route.
7. `TodoDoc` interface in `src/types/collection.ts` (~line 156) — only used by `db.ts`.
8. `src/features/event/event-form-test.tsx` — `EventFormTest` component; zero importers.

Dangling references / deps: **no package.json dependency is exclusive to these files** (chat uses raw `fetch` to OpenAI — no AI SDK installed). Optionally remove `GPT_API_KEY` from any apphosting/env config.

Acceptance criteria:
1. All 8 items above deleted; `layout.tsx` no longer imports ChatSupport.
2. `next build`, lint, and `vitest` pass; `/todo` and `/api/chat|/api/todos` return 404.
3. Repo-wide grep for `useChatbot|ChatSupport|TodoDoc|createTodo|event-form-test` returns zero hits in `src/`.

---

## M0-T3 — Firestore query inventory (input for BE)

Composite/filters found in `src/lib/db/` + API call sites (all reads are **unbounded** — no `limit()`/pagination anywhere):

| # | Collection (scope) | Query shape | Where | Index need |
|---|---|---|---|---|
| 1 | `Event` | `organizationPath ==` (×5 legacy path candidates, parallel) | `event.ts:31`, `adminEvent.ts:27` | single-field auto; flag: 5 queries per list load + in-memory sort by `updatedAt` |
| 2 | `Event` | `status == "Published"` | `adminEvent.ts:70` (public events index) | auto; **flag: cross-org unbounded read, in-memory sort** |
| 3 | `Organization` | `domain == X AND allowDomainAutoJoin == true` | `organization.ts:23` | 2×equality — served by index merging; add composite for determinism |
| 4 | `Organization` | `inviteCode == X AND inviteCodeEnabled == true` | `organization.ts:34` | same as #3 |
| 5 | `Form` | `eventId ==` | `adminForm.ts:43,89` | auto |
| 6 | `Form` | `organizationId ==` | `adminForm.ts:129` | auto; unbounded |
| 7 | `Form` | `templateLink.templateId ==` (org filtered in memory) | `adminForm.ts:145–148` | auto (nested field); **flag: org filter should move into the query → composite `templateLink.templateId + organizationId`** |
| 8 | `FormData` | `organizationId ==` | `adminFormData.ts:20` | auto; **flag: unbounded + in-memory sort by `submittedAt` — needs `organizationId ASC, submittedAt DESC` composite + limit when responses grow** |
| 9 | `FormTemplate` | `organizationId ==` | `adminFormTemplate.ts:23` | auto |
| 10 | `EventPage` | `eventId ==` (org filtered in memory) | `adminEventPage.ts:61` | auto; same in-memory-org-filter smell as #7 |
| 11 | `PromotionTemplate` | `organizationId ==` | `adminPromotionTemplate.ts:34` | auto |
| 12 | `EventPromotion` (collection) | `organizationId ==` per event subcollection | `adminEventPromotion.ts:22` | auto; org fan-out is N parallel reads (`getAdminAllEventPromotionsForOrg`) — acceptable now, revisit with collection-group |
| 13 | `EventPromotion` (collection-**group**) | `templateId == AND organizationId ==` | `adminPromotionTemplate.ts:137`, `eligible-events/route.ts:73` | **indexed** in `firestore.indexes.json` |
| 14 | `EventPromotion` (collection-group) | `templateId == AND organizationId == AND inheritFromParent == true` | `adminPromotionTemplate.ts:81` | **indexed** |

`firestore.indexes.json` today contains only #13/#14 + an `organizationId` field override. BE deliverables: composite indexes for #3, #4, #7 (after moving the org filter server-side), #8; a documented pagination policy for #1, #2, #6, #8; `agents/docs/data-models/baseline.md`.

Acceptance criteria: (1) every query above has either a listed index or a written "auto-indexed" justification in baseline.md; (2) unbounded reads #1/#2/#6/#8 flagged with a follow-up ticket or limit added; (3) emulator/live smoke of events, forms, responses, promotions lists shows no missing-index errors.

---

## M0-T4 — Test baseline: behaviors to lock (characterization)

Top 8, chosen from actual code reads:

1. **`event.ts` / `utils.ts` org scoping:** `getEventForOrganization` returns null for (a) missing event, (b) event whose `organizationPath` matches none of the 5 `buildOrganizationPathCandidates` variants; returns the event for each legacy variant (`Organization/`, `organization/`, `/organization/`, `organizations/`, `/organizations/`).
2. **`getEventsForOrganization` dedupe + sort:** duplicate IDs across path-candidate queries collapse to one; result sorted by `updatedAt.seconds` desc; docs failing `eventDocumentSchema` are silently dropped.
3. **`adminEvent.getAdminPublishedEventById`:** returns null for Draft events even when the doc exists (public-surface gate).
4. **`schema.ts` mandatory-field floor:** `formBuilderSchema`/`formDocumentSchema` reject `fields` arrays with <3 entries (mandatory first/last/email invariant).
5. **`buildFormSubmissionSchema` — required text:** required field → empty/whitespace-only string rejected with `"{label} is required"`; optional field defaults to `""` when absent.
6. **`buildFormSubmissionSchema` — email semantics:** required email rejects malformed values; **optional email accepts empty string but rejects malformed non-empty** (the `refine` branch — easiest to break in refactor).
7. **`POST /api/events/[eventId]/register` gates:** 404 when event missing or Draft; 404 `"Registration is not available yet"` when no published form; 400 with flattened Zod error for (a) non-record body, (b) submission failing the dynamically built schema.
8. **Register happy path:** valid submission → `createAdminFormData` called with `formId`, `eventId`, `organizationId` (from form, falling back to `extractOrganizationIdFromPath(event.organizationPath)`), parsed submission, server timestamp; responds `{ submissionId }`.

Acceptance criteria: (1) all 8 behaviors have failing-first assertions (not snapshots); (2) DAL/Firestore mocked at module boundary (`vi.mock` of `@/lib/db/*`) — no emulator dependency; (3) suite runs green alongside existing `src/__tests__/domain-utils.test.ts` via `npm test`.
