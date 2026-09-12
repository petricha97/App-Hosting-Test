# M9-T2 QA acceptance matrix

Verdict: **DEFECTS OPEN — verification gates incomplete**. The implemented feature passes all 81 focused automated checks and has no identified open Major implementation defect. Final visual/full E2E verification is unavailable, and the repository retains unrelated baseline test/typecheck failures. This is not an unconditional release sign-off.

Scope: approved simplified ticket flow, visible Add registration type, generated/manual/stable codes, optional quantities and dates, default audience, immediate-save continuity, sales management, and matching standalone dialogs. QA follows the approved backend/management code reviews and PASS security review. Root owns application build, whole-suite checks and browser work; results below distinguish direct runs from root evidence.

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| Three-step Ticket details → Audience & price → Review & publish flow | PASS (automated); visual checks incomplete | Wizard component tests advance/back through real rendered steps, validate required inputs, and inspect review/publish payloads. Final breakpoint/theme/focus smoke unavailable. |
| Unlimited quantity by default; optional quantity and sales schedule | PASS | Wizard and management tests check defaults, date-order validation, state across navigation, and omitted disabled dates in review/payload. Schema tests reject impossible dates and accept valid leap/single-day/one-sided windows. |
| Generated uppercase bounded codes; manual override freezes suggestions; saved codes remain stable | PASS | Code helper cases cover accented/non-Latin/empty/long names. Wizard tests cover typing, navigation and manual edits. Standalone edit tests preserve stored codes after renaming. |
| Hidden validation is visible and creation has no availability switch | PASS | Wizard/standalone tests open Advanced settings for invalid or conflicting codes. Publish payload enables sales; scheduled dates/capacity remain server-enforced. |
| Add registration type stays available and retains entered price | PASS | Inline save success inserts/selects its audience with the entered price; server collision adds no row; pending creation blocks navigation/closing. Unchecked prices survive changes of selection. |
| Empty event offers General attendee without writes on opening | PASS | Component tests assert no initial request, real default resolution on explicit Continue, retry preserving price, saved capacity display, and no creation for an excluded draft. Route/DAL tests prove scoped idempotent reuse and bounded collision checking. |
| Saved inline/default audience is available after immediate close/reopen | PASS | Final continuity tests reopen with stale props and retain real saved IDs; a reopened default requires no second ensure request. |
| Pause/resume preserves ticket details and accurately reports sales constraints | PASS | Management tests verify exact narrow payload, pending disabling, API failure/retry, and Paused/Scheduled/Ended/Sold out/On sale labels. Missing, archived or ineligible pricing gives Needs pricing; valid free pricing remains on sale. DAL tests preserve every non-sales field. |
| Standalone registration types have advanced audience limits; ticket edit preserves identifiers/dates | PASS | Management tests assert advanced fields, audience-wide capacity payload, generated/manual codes and event-local date preservation. Ticket-only creation omits disabled scheduling. |
| Existing pricing currency, validation and tenant/permission controls retained | PASS | New route/DAL tests exercise malformed/foreign requests, authenticated write permission and strict write allow-lists. Wizard publishes ordinary audience IDs and existing minor-unit prices; no currency migration. Security review PASS. |
| Duplicate publication prevented and failed publication can retry | PASS | Final wizard continuity test holds the request pending, rejects duplicate submit and verifies retry after network failure. |
| Responsive layout, both themes and final signed-in E2E | NOT FULLY VERIFIED | Uses existing theme tokens, labelled controls and responsive dialog/grid primitives. Root previously checked secondary ticket-only code generation, manual override and Cancel. Signed-in session expired; documented reconnection did not provide a browser. No final wizard visual/full E2E or live mutation is claimed. |

## Executed automated checks

Direct QA runs:

- `npx vitest run src/__tests__/create-ticket-wizard.test.tsx src/__tests__/ticket-management-ux.test.tsx src/__tests__/ticket-ux-dal.test.ts src/__tests__/ticket-ux-routes.test.ts`: **67/67 passed** (17 wizard, 13 management, 11 DAL, 26 routes).
- `npx vitest run src/__tests__/ticket-wizard-schemas.test.ts`: **14/14 passed**.
- React 18 ref warnings originate from existing shared UI primitives during component tests; assertions pass.

Root final gates (logs inspected):

- `npm run lint`: **PASS**; `/tmp/app-hosting-m9-t2-final-lint.log`.
- `npm test -- --run`: **2268 passed, 1 failed**; 204 passing files, 1 failing file. The sole failure is the existing `email-render-blocks-pipeline.test.ts:350` source-hash assertion for `merge-tags.ts`, identified by root as matching the pre-change baseline. `/tmp/app-hosting-m9-t2-final-tests.log`.
- Typecheck: root reports **10 unrelated existing fixture errors**. No changed management file errors were found in the earlier direct typecheck. This is not recorded as a passing whole-project typecheck.
- `npm run build`: **PASS**, exit 0 in root's isolated exact-source copy `/tmp/app-hosting-m9-t2-build.Hz3zG3`. Compilation, lint/production type stage and page generation completed; both new endpoints appear in the route table. `/tmp/app-hosting-m9-t2-final-build.log`. The standalone fixture type errors above did not block the production build.

## Defects and follow-up routing

- **Resolved / sales status:** unpriced secondary ticket creation initially displayed On sale. Routed from independent reviewer to management developer; fixed to Needs pricing with missing/archived/ineligible/free-price regressions. Independent reviewer approved after 13 management tests passed.
- **Resolved / immediate-save continuity:** saved registration types could be absent on immediate reopen before server refresh. Wizard developer added a scoped pending-audience cache and reopen/default/duplicate-publish regressions. Final tests pass; security delta review PASS.
- **Verification gap / root:** obtain a usable signed-in local browser session for final wizard layout, keyboard, responsive and both-theme inspection. No live-backed test ticket was created to satisfy a visual check.
- **Baseline / separate maintenance:** existing email source-hash test, TypeScript fixture failures and dependency advisories are unrelated to M9-T2 and remain outside this implementation. They prevent claiming a fully green repository. Do not alter unrelated expected hashes merely to make this ticket pass.

No production deployment, Firestore emulator load test or live data mutation was performed by this QA agent.
