# Code Review — M8-T5 Dependency Hardening

Code Reviewer, 2026-07-19. Scope: committed diff at `b00c0a5` on
`feat/m8-t5-dependency-hardening`, reviewed against
`agents/docs/specs/m8-dependency-hardening.md` and
`agents/docs/data-models/m8-dependency-hardening-execution.md`.

## Verdict — CHANGES REQUESTED

The Next 15.5.20 pin, compatible transitive remediation, application-source
compatibility, and offline quality gates are sound. Changes are requested
because the committed manifest contains an undisclosed, out-of-scope TypeScript
pin in addition to the Next pin, and because the deferred moderate findings are
described as tracked without a corresponding dependency follow-up in the
backlog.

## Blockers

None.

## Should-fix

1. **Remove or separately justify the out-of-scope TypeScript manifest change.**
   The ticket and execution record say that `package.json` changes by one line,
   solely for Next (`agents/docs/data-models/m8-dependency-hardening-execution.md:30-31`).
   The actual commit also changes `typescript` from `^5` to exact `5.9.3` at
   `package.json:51`. This violates the required diff hygiene and contradicts
   the execution evidence. Restore `^5` (and the corresponding root lockfile
   declaration) unless a separately scoped, documented TypeScript pin is
   intentionally approved.

2. **Create a real tracked dependency-major follow-up or correct the tracking
   claim.** The execution record says the residual `postcss`/`uuid` work is
   tracked via “M8-T10 grouping / a new deps-major ticket”
   (`agents/docs/data-models/m8-dependency-hardening-execution.md:25-28`), but
   `agents/docs/BACKLOG.md:54` defines M8-T10 as the unrelated server-owned
   event-path/coverage-provider review, and no deps-major ticket appears in the
   backlog. Deferring these moderate, force/major-requiring changes is
   reasonable; claiming that the deferral is tracked is not yet supported.

## Nits

None.

## Diff hygiene and version-pin correctness

- `git diff-tree --name-status -r b00c0a5` reports exactly four committed
  paths: the plan, execution record, `package.json`, and `package-lock.json`.
  No `.ts` or `.tsx` file is present. Both a path-filtered diff and a filename
  grep over the commit returned no application-source edit, so no source change
  was smuggled into the commit.
- The file set is correct, but the manifest content is not: its two declaration
  changes are `next: 15.0.5 -> 15.5.20` and
  `typescript: ^5 -> 5.9.3`. Every production declaration other than Next is
  unchanged, including `firebase:^12.9.0`,
  `firebase-admin:^13.6.1`, `react:^18`, and `react-dom:^18`
  (`package.json:21-32`). There is no new top-level production dependency.
- `next` is correctly saved as the concrete exact value `15.5.20` at
  `package.json:26`: no caret, tilde, wildcard, prerelease, 15.6+, or 16.x.
  `node_modules/next/package.json` also reports `15.5.20`. This honors the
  plan's “stay in 15.5.x” intent.
- `git diff --check b00c0a5^ b00c0a5` is clean.

## Package-lock integrity

The root lockfile production declarations differ only for Next, and no new
top-level production dependency appears. The root dev declarations also expose
the unintended TypeScript range change described above.

The installed/locked graph otherwise matches the staged remediation:

- root `@grpc/grpc-js` moved `1.9.15 -> 1.9.16`; the Google GAX nested copy is
  `1.14.4`;
- `form-data` moved `2.5.5 -> 2.5.6`;
- `protobufjs` moved `7.5.6 -> 7.6.5`;
- `websocket-driver` moved `0.7.4 -> 0.7.5`;
- `next` moved `15.0.5 -> 15.5.20`;
- compatible resolver movement also updates installed `firebase-admin`
  `13.8.0 -> 13.10.0`, still within the unchanged declared 13.x caret range.

No unexpected new root dependency or incompatible production-major movement
was found.

## Breaking-change re-verification

No codebase-hit Next 15.x breaking change missed by the plan was found.

- Middleware: `rg --files` found no repository `middleware.ts`, `.tsx`, `.js`,
  or `.mjs`.
- Async request APIs: representative shared auth awaits `cookies()` at
  `src/lib/session.ts:18`; the public dynamic page declares promise-typed
  `params` and `searchParams` and awaits both at
  `src/app/events/[eventId]/page.tsx:27-38`; the page builder does likewise at
  `src/app/dashboard/(event)/events/[eventId]/page-builder/page.tsx:22-33`;
  and a representative route awaits both route params and cookies at
  `src/app/api/dashboard/events/[eventId]/form/route.ts:36-42`. The exhaustive
  `cookies()` search found awaited call sites, and searches found no
  `headers()` or `draftMode()` use.
- Configuration: `next.config.mjs:1-4` exports an empty `NextConfig` object, so
  no removed or renamed option is exercised.
- Searches also found no internal `next/dist/*` import and no use of the named
  caching or image-optimizer surfaces that would invalidate the plan's safety
  analysis.

## Offline gate reproduction and evidence consistency

- `npm run lint` — **PASS**, exit 0, no ESLint warnings/errors. Next emitted
  informational notices that `next lint` is deprecated for Next 16 and that a
  parent-directory lockfile affected workspace-root inference.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the documented seven
  baseline errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No new
  location appeared.
- `npm test -- --run` — **PASS**, exactly **182 test files / 2017 tests**. The
  run emitted existing React ref/`act` and development-secret warnings but no
  failure.
- I did not rerun `npm run build` because the requested offline reviewer reruns
  were lint, typecheck, and tests; the Orchestrator records build exit 0 at both
  stages.
- I could not rerun `npm audit --omit=dev` because this sandbox has no registry
  access. The audit claim therefore relies on the authoritative captured
  figures: **15 -> 11 vulnerabilities, 2 critical/3 high -> 0 critical/0 high**
  (`agents/docs/data-models/m8-dependency-hardening-execution.md:5-24`). The
  installed patched versions are consistent with that account, but are not an
  independent audit reproduction.

## Residual and deferral judgment

The technical split is reasonable. Root `postcss` remains `8.4.31` while the
patched Tailwind/Vite copies are `8.5.13`; changing the remaining copy cannot be
assumed safe through a blanket override. The graph also retains `uuid@9.0.1`
through consumers with older-major constraints. Clearing those findings by
`--force` or cross-major overrides requires consumer-by-consumer compatibility
work. Next 16 also carries framework/lint migration implications, and React 19
is a separate major. None belongs in this non-breaking ticket.

The deferral itself is therefore accepted, but its tracking is not: the
execution record's cited M8-T10 is unrelated and no concrete dependency-major
follow-up exists in `agents/docs/BACKLOG.md`. That is Should-fix 2.

## Report-file confirmation

This review report was written as the sole workspace modification made by the
reviewer at `agents/docs/reviews/m8-dependency-hardening.md`. Pre-existing
unrelated working-tree changes (`HANDOVER.md`, `.claude/settings.json`,
`CLAUDE.md`, and `memory/`) were not modified.
