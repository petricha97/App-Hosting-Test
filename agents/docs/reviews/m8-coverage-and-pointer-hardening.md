# Code Review — M8-T10 Coverage and Event-Pointer Hardening

Code Reviewer, 2026-07-19. Scope: the complete uncommitted M8-T10 working-tree
diff: `vitest.config.mts`, `package.json`, `package-lock.json`, and
`src/__tests__/m8-t4-fullstack-event-assets-settings-routes.test.ts`. I also
checked `.gitignore` and the complete tracked diff for production changes.
Unrelated untracked workspace files were not treated as M8-T10 implementation.

## Verdict — CHANGES REQUESTED

The dependency, script, threshold wiring, pointer regressions, and requested
validation runs are sound. Changes are requested because the coverage excludes
are not honest: the blanket `src/**/index.ts` and `src/**/types.ts` patterns
currently remove real application logic, including a security-critical email
renderer dispatch and several data serializers. Consequently, `all: true` is
present but the reported baseline and regression floors do not cover all real
application logic.

## Exclude-honesty verdict

**Fail.** `all: true` is correctly set at `vitest.config.mts:27`, so included
untested files count as zero. The test, declaration, configuration, and
`node_modules` exclusions are appropriate. However, filename conventions are
being used as a proxy for type-only/barrel content, and the repository contains
counterexamples:

- `src/features/emails/server/blocks/index.ts:44-125` is not a barrel. It owns
  the email-safe block allowlist set, the type guard, property normalization,
  and the HTML/plain-text renderer dispatch switches. The
  `src/**/index.ts` exclusion at `vitest.config.mts:34` hides this real,
  security-relevant behavior.
- `src/features/pricing/types.ts:64-109` contains `serializeFee`, `serializeTax`,
  and `serializeDiscount`; `src/features/registration-paths/types.ts:24-37`
  contains `serializeRegistrationPath`; and
  `src/features/registration/types.ts:34-79` contains timestamp conversion and
  registration/ticket serializers. The `src/**/types.ts` exclusion at
  `vitest.config.mts:33` hides all of these runtime functions.
- `src/features/emails/server/blocks/types.ts:55` also has a runtime exported
  constant. It is small, but further proves the glob is not limited to
  type-only modules.

The actual barrel `src/features/event/overview/index.ts:1-3` and genuinely
type-only modules may be excluded, but the patterns must be narrowed to an
explicit audited list (or runtime code moved out of the excluded filenames).
No routes, feature modules, DAL files, or behavioral components are otherwise
excluded by the submitted patterns.

## Threshold verdict

The configured thresholds at `vitest.config.mts:44-49` pass today: statements
57, branches 49, functions 50, and lines 58 versus the configured measurement
of 58.87 / 50.25 / 51.95 / 59.87. Margins of 1.25-1.95 percentage points are
tight enough to catch a material regression rather than merely providing a
token floor. The comment at `vitest.config.mts:41-43` records all four baseline
values and explicitly documents ratcheting toward 80%+, especially branches
and functions.

This is nevertheless **not yet an honest all-logic regression floor**, because
the measured baseline is inflated by the runtime-code exclusions above. After
fixing those excludes, remeasure the baseline and reset the four thresholds to
approximately one point below the corrected totals; do not retain the current
numbers merely to keep the command green.

## Dependency, script, and ignore checks

- `package.json:49` pins `@vitest/coverage-v8` exactly to `4.0.18`, matching the
  installed Vitest 4.0.18 line (`package.json:55`; Vitest itself retains its
  pre-existing caret range). `package-lock.json` records coverage-v8 4.0.18 and
  its peer dependency on Vitest 4.0.18.
- `package.json:11` adds `test:coverage` as `vitest run --coverage`.
- `.gitignore:10` contains `/coverage`; the generated directory is ignored.
- Normal `npm test` remains `vitest` at `package.json:10`; coverage is enabled
  only by the dedicated script/flag, as confirmed by the normal suite run.

## Pointer-regression tests and production scope

The two tests at
`src/__tests__/m8-t4-fullstack-event-assets-settings-routes.test.ts:86-107`
are genuine route regressions. Each submits a changed server-owned pointer,
asserts HTTP 403 and the expected error body, and asserts the fake DAL's
`updateEvent` was not called. They reuse the same authenticated event fixture
and mock store as the sibling `organizationPath`/`formPath` tests. The
`eventPagePath` test changes an absent stored pointer to a foreign path; the
`invoicePath` test changes the stored empty pointer to a foreign path.

`git diff --quiet HEAD -- src ':(exclude)src/__tests__/**'` exits 0. The complete
tracked diff contains no production-code modification: Part B changes only the
existing test file.

## Blockers

None.

## Should-fix

1. **Remove the broad runtime-code exclusions and rebaseline.**
   `vitest.config.mts:33-34` excludes every `types.ts` and `index.ts` even when
   it contains executable application logic. At minimum, restore coverage for
   the modules listed in the exclude-honesty section, then rerun coverage and
   set all four floors approximately one point below that honest `all: true`
   result. This is approval-blocking because exclude honesty is the ticket's
   principal risk and the purpose of the enforced floor.

## Nits

None.

## Independent run results

- `npm run lint` — **PASS**, exit 0, no ESLint warnings or errors. Next.js
  emitted its existing deprecation/workspace-root notices.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected seven
  baseline errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No
  M8-T10 file produced a TypeScript error.
- `npm test -- --run` — **PASS**, **187 test files / 2070 tests**. This confirms
  the coverage config does not alter normal test behavior. Existing React ref,
  development-secret, and expected error-path diagnostics were emitted.
- `npm run test:coverage` — **PASS**, exit 0, **187 test files / 2070 tests**;
  statements **58.87%**, branches **50.25%**, functions **51.95%**, lines
  **59.87%**. These are the configured/globbed totals and therefore remain
  subject to the exclude-honesty finding.

## Report-file confirmation

This review report was written as the sole workspace modification made by the
reviewer at `agents/docs/reviews/m8-coverage-and-pointer-hardening.md`.
