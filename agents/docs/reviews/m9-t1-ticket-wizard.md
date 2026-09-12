# M9-T1 — Create Ticket wizard — Code Review

## Verdict: APPROVED

## Summary of checks performed
- Read spec (`agents/docs/specs/m9-ticket-wizard.md`) in full and diffed the actual implementation against every AC in §8.
- `git status --short` matches the declared file list exactly.
- Confirmed byte-for-byte untouched: `.../tickets/route.ts`, `.../registration-types/route.ts`, `adminTicketType.ts`, `adminFee.ts`, `adminRegistrationType.ts` (`git diff --stat` empty for all).
- `npm run lint` — clean.
- `npx tsc --noEmit` — same pre-existing error set with and without this diff stashed (all in unrelated test files: `assets-utils`, `attendees-roster`, `email-template-variables`, `event-org-scoping`, `register-route`); zero new-file errors.
- `npx vitest run` — 200/201 files, 2195/2196 tests pass. The one failure (`email-render-blocks-pipeline.test.ts` hash tripwire on `merge-tags.ts`) reproduces identically with this diff stashed out and `merge-tags.ts` has no diff — confirmed pre-existing/unrelated.
- Grepped diff for `firebase-admin`/`firebase/firestore` outside `src/lib/db/`/`src/lib/fees/` — none found; DAL boundary respected.

## Findings

**Blockers:** none.

**Should-fix:**
- `agents/docs/BACKLOG.md:1` (whole file) — spec §7 explicitly calls for adding an `M9-T1` row + `## M9` section header; no `M9` entry exists anywhere in `BACKLOG.md`. Minor process gap, not a code-correctness issue — flag for whoever owns backlog bookkeeping before this is considered fully done per the spec's own file list.

**Nits:** none of note.

## Detailed verification against the review focus areas

1. **Transaction correctness** (`src/lib/db/adminTicketTypeWithPricing.ts`): all reads (`codeSnap`, `registrationTypeSnaps`) happen via `tx.get` before the decision point; both failure branches (`CODE_TAKEN`, `UNKNOWN_REGISTRATION_TYPE`) `return` a discriminated result rather than `throw`, avoiding Firestore's automatic retry-on-throw. Registration-type membership check treats missing and foreign (wrong `eventId`/`organizationId`) identically as "unknown" (lines 178-190) — IDOR-safe.
2. **No Fee-uniqueness check**: `ticketRef = ticketTypeCol().doc()` is allocated fresh inside this same transaction (line 208), and every `Fee.ticketTypeId` written points at that freshly-allocated id — no prior Fee document can reference an id that didn't exist before this transaction. Verified with a dedicated test (`admin-ticket-type-with-pricing.test.ts`) asserting the only `.where()` query issued is against `TicketType`, never `Fee`.
3. **`registrationTypeIds` server-derivation**: the Zod schema (`schemas.ts`) has no `registrationTypeIds` field at all (Zod strips unknown keys); the DAL always computes `uniqueRegistrationTypeIds` from `prices` (line 128) and writes that, never a client-supplied array. Route-level test explicitly asserts a client-supplied `registrationTypeIds` in the body never reaches the DAL call.
4. **Quick-add**: `registration-type-quick-add.tsx` POSTs directly to the existing, unmodified `/registration-types` route, reuses `registrationTypeFormSchema`/`buildRegistrationTypePayload`/`applyApiFormError` as-is. A 409 duplicate surfaces as a field-level error on the mini-form's code input (verified in `create-ticket-wizard.test.tsx`), no row is appended, and the rest of wizard state is untouched.
5. **Comment quality**: transaction function, schema file, quick-add component, and wizard shell all carry substantive "why" comments (retry-vs-throw rationale, fee-uniqueness-by-construction rationale, immediate-persist rationale, step-navigation state-machine rationale) — not boilerplate.
6. **Code quality**: naming/structure consistent with sibling DAL/route/dialog conventions; no swallowed errors (network/500 paths all surface a toast or field error); no mutation of shared state (row updates use `.map`/spread); files are reasonably sized (largest is 335 lines). Tests assert real behavior — write counts (`fake.writes`), rollback-on-abort (zero writes), derived `registrationTypeIds` set-equality, and UI error routing — not snapshot-only checks.

## Relevant files
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/lib/db/adminTicketTypeWithPricing.ts`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/features/ticket-wizard/schemas.ts`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/lib/fees/wizard-fee-name.ts`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/app/api/dashboard/events/[eventId]/tickets/with-pricing/route.ts`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/features/ticket-wizard/components/create-ticket-wizard.tsx`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/features/ticket-wizard/components/step-audience-pricing.tsx`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/features/ticket-wizard/components/registration-type-quick-add.tsx`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/features/ticket-wizard/components/step-details.tsx`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/features/ticket-wizard/components/step-review.tsx`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/features/registration/components/ticket-types-workspace.tsx`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/__tests__/admin-ticket-type-with-pricing.test.ts`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/__tests__/tickets-with-pricing-route.test.ts`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/__tests__/wizard-fee-name.test.ts`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/__tests__/create-ticket-wizard.test.tsx`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/agents/docs/BACKLOG.md` (should-fix: missing M9 entry)
