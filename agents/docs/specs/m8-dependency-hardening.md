# M8-T5 — Dependency hardening upgrade plan

## Purpose and scope

This is the read-only research/implementation plan for M8-T5. The ticket boundary is the one recorded in `agents/docs/BACKLOG.md:526-530`: update `next` from 15.0.5 to the latest patched 15.5.x release and apply non-breaking audit fixes, especially the `firebase-admin`/Google Cloud transitives `@grpc/grpc-js`, `protobufjs`, and `form-data`.

Major-line migrations (`next` 16, React 19, or major changes needed to clear `postcss`/`uuid`) are explicitly deferred. The implementation must never run `npm audit fix --force` in this ticket.

## Current state

| Item | Declared / resolved state | Evidence and assessment |
|---|---|---|
| Next.js | Exact declaration and install: `15.0.5` | `package.json:26`; `node_modules/next/package.json:2-4`. The installed package contains no bundled changelog/release-notes file. |
| Latest 15.5.x patch | Not determinable from local metadata | Neither `package-lock.json` nor `node_modules/.package-lock.json` contains a 15.5.x Next package record. `npm view next@15.5 version --offline` returns `ENOTCACHED`. The network-capable Orchestrator must resolve the patch at execution time and save it exactly. |
| React / React DOM | `^18` / `^18` | `package.json:31-32`; deliberately unchanged. |
| `firebase-admin` | Declared `^13.6.1`; resolved `13.8.0` | `package.json:22`; `node_modules/firebase-admin/package.json`. No `firebase-admin` major bump is required by the safe transitive work. |
| Production audit | 15 vulnerabilities: 10 moderate, 3 high, 2 critical | Authoritative Orchestrator snapshot supplied with the ticket. Local audit data was not available offline. |
| Next config | Empty options object | `next.config.js:1-4`; no experimental, image, cache, output, webpack, Turbopack, or server-action flags to migrate. |
| App Hosting config | Cloud Run sizing and environment/secrets only | `apphosting.yaml:1-94`; no Next-specific build/runtime option. |
| Middleware | None | Repository-wide filename search found no `middleware.ts`, `.tsx`, `.js`, or `.mjs`; this matches `agents/docs/security/m5-attendees-checkin.md:16-19`. Middleware-bypass/redirect advisories are therefore not directly reachable today, although other Next DoS/cache/image issues still justify the update. |

## Next 15.0.5 to 15.5.x: codebase-specific compatibility review

Overall verdict: **low implementation risk / expected to be source-compatible**, subject to the full build and test gates. This repository already uses the async request-API shape introduced and tightened throughout Next 15, has no middleware or custom Next configuration, and does not use the affected explicit caching/image/experimental surfaces. The main operational risk is framework behavior changing under a large application rather than an identified source incompatibility.

| Area touched across Next 15.x | Repository evidence | Will it break here? / action |
|---|---|---|
| Async `cookies()` / `headers()` / `draftMode()` | Every `cookies()` call found is awaited; representative shared auth paths are `src/lib/session.ts:18`, `src/lib/server/caller-token.ts:21`, `src/features/reports/server/reports-route-scope.ts:45`, and `src/features/registration/server/route-scope.ts:45`. No `headers()` or `draftMode()` call was found. | **No identified break.** The code does not depend on the temporary synchronous compatibility path. Typecheck and build remain mandatory because generated Next route types get stricter between minors. |
| Async page/layout/route `params` | Dynamic pages and route handlers type parameters as promises and await them. Examples: `src/app/events/[eventId]/page.tsx:27-38`, `src/app/dashboard/(event)/events/[eventId]/layout.tsx:57-61`, and `src/app/api/dashboard/events/[eventId]/form/route.ts:36-42`. Repository search found no non-Promise App Router `params` declaration. | **No identified break.** Already migrated to the 15.x contract. |
| Async page `searchParams` | Promise-typed and awaited, including `src/app/events/[eventId]/page.tsx:30-36`, `src/app/dashboard/(event)/events/[eventId]/page-builder/page.tsx:22-33`, and `src/app/dashboard/(event)/events/[eventId]/responses/page.tsx:27-35`. Repository search found no non-Promise page `searchParams` declaration. | **No identified break.** URL parsing in route handlers uses `request.url`/`URL.searchParams`, which is unrelated. |
| Middleware behavior/security fixes | No middleware file exists; auth is performed in server pages/route handlers. | **No source break expected.** The middleware-specific critical paths are currently unreachable, but upgrading prevents future accidental exposure and addresses non-middleware Next advisories. Smoke-test authentication redirects after the build. |
| Caching and dynamic rendering defaults | No `unstable_cache`, `revalidatePath`, `revalidateTag`, route `revalidate`, `fetchCache`, or explicit fetch `cache`/`next` option was found. The only route segment override is `export const dynamic = "force-dynamic"` at `src/app/api/internal/email-triggers/evaluate/route.ts:41`. | **Low behavioral risk.** The one explicit dynamic route remains explicit. Because the rest relies on framework defaults, smoke-test a public event page plus authenticated dashboard reads after deployment; do not add cache flags speculatively. |
| Image optimization/config | No `next/image`, `<Image>`, `ImageResponse`, or `images` config was found; `next.config.js:2` is empty. | **No identified break** and vulnerable image-optimizer paths have no direct application call site. |
| Next config / experimental flags / bundler hooks | `next.config.js:1-4` exports `{}`. No `experimental`, webpack, Turbopack, `output`, `transpilePackages`, or server-action config was found. | **No config migration needed.** |
| `next/*` imports | Usage is limited to stable public surfaces: `next/link`, `next/navigation`, `next/server`, `next/headers`, and type imports from `next`; examples include `src/app/page.tsx:1`, `src/app/events/[eventId]/page.tsx:9`, `src/app/api/auth/session/route.ts:1`, and `src/lib/session.ts:6-7`. | **Low risk.** No internal `next/dist/*` import was found. Exercise navigation, redirects/not-found handling, and one API route in smoke tests. |
| Lint integration | The script is `next lint` (`package.json:9`) and `eslint-config-next` is independently pinned to 15.0.0 (`package.json:49`). | **Specific tooling risk, not an expected 15.5 runtime break.** Run the lint gate immediately after the Next stage. Do not broaden this ticket to ESLint/config migrations unless 15.5.x actually makes the gate fail; if it does, align `eslint-config-next` to the same exact 15.5 patch as a tightly scoped corrective change and rerun all gates. Next 16 migration/removal work remains deferred. |
| App Hosting | `apphosting.yaml:3-8` only sets Cloud Run capacity; lines 11-94 define environment/secrets. | **No framework-config break expected.** Still require the production build because the App Hosting adapter itself is not reproducible from static inspection. |

## Transitive dependency analysis

### In-scope Firebase/Google Cloud fixes

The authoritative audit says all three high-severity items are fixable by plain `npm audit fix`, not `--force`. The installed dependency ranges corroborate that the resolver can move them without a `firebase-admin` major:

| Advisory package | Current path(s) and ranges | Verdict |
|---|---|---|
| `@grpc/grpc-js` | The server/Admin path is `firebase-admin@13.8.0` → optional `@google-cloud/firestore@^7.11.0` → `google-gax@^4.3.3` → `@grpc/grpc-js@^1.10.9`; it already resolves a nested 1.14.3. A second root copy, 1.9.15, comes from client `firebase@12.9.0` → `@firebase/firestore@4.11.0`. | **Non-breaking-fixable according to audit.** Caret ranges permit compatible 1.x movement; no Admin major is necessary. Verify that *all* installed copies are outside the audited range after Stage 1. |
| `protobufjs` | `@google-cloud/firestore@7.11.6` requests `^7.2.6`; `google-gax@4.6.1` requests `^7.3.2`; `@grpc/proto-loader@0.7.15` requests `^7.2.5`. Current shared resolution is 7.5.6. | **Non-breaking-fixable according to audit.** All relevant ranges admit a patched 7.x release above 7.6.2; no Admin major is necessary. |
| `form-data` | `firebase-admin` → optional `@google-cloud/storage@^7.19.0` → `retry-request@^7.0.0` → `@types/request@^2.48.8` → `form-data@^2.5.5`; current version is 2.5.5. | **Non-breaking-fixable according to audit.** The range admits 2.5.6, the stated fixed floor, without an Admin major. |

`firebase-admin` itself declares no peer dependencies in the installed package. Its relevant Google Cloud packages are optional dependencies (`@google-cloud/firestore:^7.11.0`, `@google-cloud/storage:^7.19.0`), so a lockfile refresh can update compatible descendants while keeping the declared `firebase-admin:^13.6.1` and resolved 13.x line.

### `websocket-driver` critical

This is **not dev-only**. The production tree is:

`firebase@12.9.0` → `@firebase/database@1.1.0` → `faye-websocket@0.11.4` → `websocket-driver@0.7.4`.

Evidence: `package.json:21` declares `firebase`; installed `@firebase/database` pins `faye-websocket` 0.11.4, while installed `faye-websocket` accepts `websocket-driver >=0.5.1`. The authoritative audit explicitly labels the fix as plain `npm audit fix`. Therefore it is a **safe Stage 1 collateral fix and in scope**, even though it was not one of M8-T5's three named Firebase Admin packages. Confirm the resolved version is greater than 0.7.4 and that the critical disappears after Stage 1.

## Safe in-ticket changes versus deferred work

### A. Safe changes to perform in M8-T5

1. Run `npm audit fix --omit=dev` with **no `--force`**. Accept only compatible lockfile/package movements proposed by npm. This should fix `websocket-driver`, `@grpc/grpc-js`, `protobufjs`, `form-data`, and any other advisory npm can clear without changing a declared dependency across a major boundary.
2. Update Next separately to the registry-resolved latest `15.5.x`, saved as an exact version. Keep React/React DOM on 18.
3. Review both manifest and lockfile diffs after each stage. Stop if npm unexpectedly changes a top-level dependency across a major or edits unrelated declarations.

Stage 1 comes first because it isolates low-risk transitive resolver changes from the framework update. If its gate fails, the failure cannot be blamed on Next. Stage 2 then has its own gate, making any framework regression attributable.

### B. Explicitly deferred to a tracked follow-up

Create/retain a follow-up ticket for the force-requiring residuals and their coordinated migrations:

- **Next 16:** out of scope. It may be npm audit's proposed full-clear target, but entails a framework major, React/tooling compatibility review, and likely lint workflow changes.
- **React / React DOM 19:** out of scope; do not let a forced Next remediation pull them in.
- **`postcss` force/major remediation:** out of scope as defined by the ticket. The vulnerable root `postcss@8.4.31` is under Next 15.0.5, while newer copies under Tailwind/Vite are 8.5.13. Re-evaluate the actual tree after the 15.5.x bump: if the Next minor naturally clears it, record that win; otherwise defer rather than force.
- **`uuid` major remediation:** out of scope. Multiple production copies exist: 9.0.1 under `@measured/puck` and Google Cloud/gaxios/teeny-request, 8.3.2 under Storage, and 11.1.1 at the Admin root. Do not add overrides blindly: consumers span incompatible major ranges and overrides can create runtime/API risk.

Residual risk is accepted only temporarily: `postcss` remains a moderate parser/toolchain exposure and old `uuid` copies remain moderate production transitives. The critical/high items and Next 15 advisories are not accepted residuals for this ticket unless the fresh audit contradicts the supplied remediation metadata; any such contradiction must be escalated with the new audit output rather than forced.

## Orchestrator execution runbook

Run from the repository root in a clean M8-T5 implementation branch. Preserve a baseline copy outside the two files before Stage 1 if desired; do not commit unrelated working-tree changes.

### Baseline (read-only checks)

```sh
git status --short
git diff -- package.json package-lock.json
npm audit --omit=dev
npm ls next firebase-admin @grpc/grpc-js protobufjs form-data websocket-driver postcss uuid --all --omit=dev
```

### Stage 1 — compatible audit remediation only

```sh
npm audit fix --omit=dev
git diff -- package.json package-lock.json
npm audit --omit=dev
npm ls @grpc/grpc-js protobufjs form-data websocket-driver --all --omit=dev
npm run lint && npx tsc --noEmit && npm run build && npm test -- --run
```

Diff acceptance checks before proceeding:

- no `--force` was used;
- no top-level dependency crossed a major line;
- `firebase-admin` remains on 13.x;
- every `websocket-driver` is above 0.7.4, every `protobufjs` is above 7.6.2, and `form-data` is at least 2.5.6;
- the fresh audit no longer reports the supplied websocket/gRPC/protobuf/form-data critical/high advisories.

If any condition fails, stop and retain the command output for Security; do not compensate with overrides or force.

### Stage 2 — latest patched Next 15.5.x, exact-pinned

The `x` selector lets the registry resolve the highest available 15.5 patch at execution time; `--save-exact` records the resulting concrete version rather than a range.

```sh
npm i --save-exact next@15.5.x
node -p "require('./package.json').dependencies.next"
node -p "require('./node_modules/next/package.json').version"
git diff -- package.json package-lock.json
npm audit --omit=dev
npm ls next react react-dom postcss --all --omit=dev
npm run lint && npx tsc --noEmit && npm run build && npm test -- --run
```

Both printed Next versions must be identical concrete `15.5.<patch>` values. Reject 15.6+, 16.x, prerelease/canary, or a saved `^`/`~`/`x` range. React and React DOM must remain on 18.x. If lint alone fails due to the known tool-version skew, align `eslint-config-next` to the identical concrete 15.5 patch as a narrowly justified corrective sub-step, then rerun the complete Stage 2 gate; do not perform a broader ESLint migration.

### Final evidence for Security/QA

```sh
npm audit --omit=dev
npm ls next firebase-admin @grpc/grpc-js protobufjs form-data websocket-driver postcss uuid --all --omit=dev
git diff --check
git diff -- package.json package-lock.json
```

Record the resolved Next patch and before/after audit counts in the ticket. The full four-command gate must be successful after **each** stage; a final-only green run is insufficient for attribution.

## Expected post-upgrade audit state

Based on the supplied audit remediation labels:

| Advisory group | Expected after Stage 1 + Stage 2 |
|---|---|
| `websocket-driver <=0.7.4` critical | **Cleared** by non-force Stage 1. |
| `@grpc/grpc-js` high | **Cleared** by non-force Stage 1. |
| `protobufjs <=7.6.2` high | **Cleared** by non-force Stage 1. |
| `form-data <2.5.6` high | **Cleared** by non-force Stage 1. |
| Next advisory range shown as critical | **Expected to be cleared for the chosen patched 15.5.x**, consistent with the ticket definition. However, the supplied current audit's broad range text (`9.3.4-canary.0 - 16.3.0-canary.5`) appears to include all 15.5 releases and proposes `--force`; this conflicts with the ticket's premise. Security must judge the fresh advisory IDs/ranges after resolution. Never jump to Next 16 automatically. If npm still flags 15.5.x, record it as a known deferred Next residual and open/escalate the follow-up. |
| `postcss <8.5.10` moderate | **May clear naturally** if Next 15.5.x resolves a patched PostCSS, but because the current audit says force is required, the conservative expected residual is **still present**. Defer if it remains. |
| `uuid <11.1.1` moderate, multiple copies | **Expected to remain** for 8.x/9.x descendants whose consumers require older majors. Defer; do not force or blanket-override. |
| Other plain-`npm audit fix` items | **Expected cleared** in Stage 1, subject to diff review and gates. |

Security's expected gate is therefore: no known non-force-fixable critical/high advisories; documented moderate `postcss`/`uuid` residuals are allowed for the follow-up. A remaining Next critical caused by the audit-range conflict is not silently accepted: it requires explicit Security escalation and tracking, but still does not authorize an in-ticket major bump.

## Rollback

Rollback is stage-local so the last known-green state is preserved.

1. Restore **only** `package.json` and `package-lock.json` to the snapshot/commit from immediately before the failing stage (for example, with the Orchestrator's saved copies or an explicit VCS restore of those two paths after confirming the diff). Do not reset the worktree broadly.
2. Recreate dependencies exactly from the restored lockfile:

   ```sh
   npm ci
   npm run lint && npx tsc --noEmit && npm run build && npm test -- --run
   ```

3. If Stage 2 fails, roll back to the post-Stage-1 green manifest/lockfile, not necessarily all the way to the ticket baseline. If Stage 1 fails, roll back to the original baseline.
4. Attach the failing command, dependency diff, and audit/tree output to the follow-up; do not use `npm audit fix --force` as recovery.

## Offline limitations and required online verification

- The exact latest 15.5.x patch could not be pinned: no 15.5 Next metadata is present in either lockfile or the installed package, the installed Next package has no bundled changelog, and the npm metadata request is not cached. The Orchestrator must resolve and exact-pin it from the registry.
- Release-note details for each of 15.1/15.2/15.3/15.4/15.5 could not be independently fetched. The compatibility verdict is based on exhaustive repository usage/config searches and installed package metadata, not an online changelog review.
- A current audit report/advisory JSON could not be fetched offline. Counts, severities, fixed floors, and force/non-force classifications in this plan use the authoritative snapshot supplied by the Orchestrator.
- The broad Next critical range in that snapshot conflicts with the stated goal that a patched 15.5.x clears the ticket's Next advisories. Only the fresh post-resolution audit (including advisory IDs and `fixAvailable` data) can settle that conflict.
- No install, lockfile update, build, lint, typecheck, or test was run as part of this research. Those are intentionally delegated to the network-capable Orchestrator and isolated by the staged gates above.
