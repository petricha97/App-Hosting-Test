# Security Review — M8-T5 Dependency Hardening

Security Agent, 2026-07-19. Scope: staged dependency upgrade at `b00c0a5`
on `feat/m8-t5-dependency-hardening`. Reviewed against the ticket spec and the
Orchestrator-captured execution/audit record. This environment has no npm
registry access, so the audit was not rerun; audit counts and advisory
disposition below use that authoritative pre/post evidence.

## Gate result — PASS

**PASS — production audit moved from 2 Critical / 3 High / 10 Moderate to
0 Critical / 0 High / 11 Moderate.**

The ticket eliminates the entire critical/high surface. No reachable
critical/high or serious runtime cross-tenant, RCE, or authentication issue
remains. The 11 moderate findings are accepted for tracked deferral because
PostCSS is build-time tooling and the UUID advisory's required call shape is
not used. Major/`--force` remediation remains tracked under the M8-T10
grouping or a dedicated dependency-major follow-up, as specified by the
execution record.

| Severity | Before | After | Gate disposition |
|---|---:|---:|---|
| Critical | 2 | 0 | Cleared |
| High | 3 | 0 | Cleared |
| Moderate | 10 | 11 | Accepted, non-reachable/build-time, tracked deferral |

## 1. Cleared critical/high reachability

| Cleared advisory | Reachability in this application | Security verdict |
|---|---|---|
| `next`, GHSA-f82v-jwr5-mffw, critical middleware authorization bypass | **Not reachable before the fix.** Repository-wide filename search finds no `middleware.ts`, `.tsx`, `.js`, or `.mjs`; authentication and tenant checks are implemented in server pages/routes instead. The advisory requires affected middleware behavior. | Defense-in-depth clearance. It removes risk if middleware is introduced later, but there was no exploitable middleware path here. |
| `websocket-driver`, GHSA-mp7j-qc5w-4988 / GHSA-xv26-6w52-cph6, critical | **Dependency present, application path not exercised.** The production tree was `firebase` -> `@firebase/database` -> `faye-websocket` -> `websocket-driver`, but source inspection finds no Realtime Database import or `getDatabase()` call; the client uses Firestore and Storage. | Defense-in-depth clearance of a production transitive. The vulnerable WebSocket parser was shipped in the dependency graph even though this codebase does not open that database transport. |
| `@grpc/grpc-js`, GHSA-5375 / GHSA-99f4, high | **Runtime-reachable dependency family.** The server uses `firebase-admin` Firestore extensively; Firestore reaches `google-gax` and gRPC. App callers do not directly construct low-level gRPC frames, so exploitation would depend on a malicious/abnormal remote peer or response, but a crash/DoS path sits in an exercised server stack. | Material defense-in-depth improvement; correctly blocking before remediation because the server process uses this transport. Patched copy is `1.14.4` in the reviewed lockfile. |
| `form-data`, GHSA-hmw2-7cc7-3qxx, high CRLF/injection | **Runtime-reachable dependency family, vulnerable input not directly controlled.** Authenticated avatar, organization-logo, and event-asset routes use Admin Storage (`bucket.file(...).save(...)`), whose Google Cloud request stack pulled `form-data`. Application code does not import `form-data` or construct multipart headers/boundaries, so attacker control is constrained by the Storage client rather than passed to the vulnerable API directly. | Material defense-in-depth improvement for exercised upload paths. Patched from `2.5.5` to `2.5.6`. |
| `protobufjs`, GHSA-jggg / GHSA-wcpc / GHSA-f38q, high DoS | **Runtime-reachable dependency family.** Admin Firestore uses `google-gax`, `@grpc/proto-loader`, and `protobufjs`; therefore protobuf parsing is part of normal server operation. App code does not parse attacker-supplied schemas/protobuf payloads directly, making exploitation dependent on the service/transport boundary, but server-process DoS was plausible enough to require clearance. | Material defense-in-depth improvement for an exercised server stack. Patched from `7.5.6` to `7.6.5`. |

All five critical/high package groups are absent from the authoritative post
audit. The upgrade therefore provides real security value even where the
specific vulnerable entry point was not application-reachable.

## 2. Residual moderate adjudication

### `postcss <8.5.10` — acceptable to defer

The remaining vulnerable copy is `postcss@8.4.31`, pinned under
`next@15.5.20`. PostCSS is used while Next compiles CSS; it is a parser/build
pipeline dependency, not browser code and not an application request handler.
The other build-pipeline copies are already patched:
`@tailwindcss/postcss@4.2.0 -> postcss@8.5.13` and
`vite -> postcss@8.5.13`.

No route accepts CSS for on-demand compilation, and no application source
imports PostCSS. Consequently an attacker cannot send tenant-controlled CSS
to this parser in the deployed server runtime. Risk is confined to a
developer/CI build processing trusted repository CSS. This is neither a
runtime cross-tenant nor RCE/authentication surface and is acceptable to
defer rather than force a framework-major change.

### `uuid <11.1.1` — acceptable to defer

The advisory affects UUID v3/v5/v6 only when the optional `buf` argument is
provided. A repository-wide application-source search found no UUID import,
require, v3/v5/v6 call, or buffer-bearing UUID call. Inspection of every
named installed consumer found:

- `@measured/puck@0.20.2`: calls only `v4()` to generate editor IDs, with no
  arguments.
- `@google-cloud/storage@7.21.0`: has no direct UUID call; it pulls the
  affected version through its request dependencies.
- `google-gax@4.6.1`: calls only `v4()` with no arguments.
- `gaxios@6.7.1`: calls only `v4()` with no arguments for multipart
  boundaries. The Admin-root `gaxios@7.1.4` no longer depends on UUID.
- `teeny-request@9.0.0`: calls only `uuid.v4()` with no arguments for a
  multipart boundary.

`npm ls --omit=dev --all` shows these consumers deduplicated onto
`uuid@9.0.1`. None invokes v3, v5, or v6, and none supplies `buf`; thus the
buffer-bounds path is not reachable. UUID v4 use is outside the advisory's
vulnerable path. Forcing incompatible consumer majors or a blanket override
would add compatibility risk without closing an exercised vulnerability.
The tracked dependency-major follow-up is the correct remediation boundary.

**Residual conclusion:** none of the 11 moderate audit instances is a
reachable serious server-runtime, client-runtime, cross-tenant, RCE, or auth
issue. They satisfy M8-T5's explicit deferral rule and do not block the gate.

## 3. New dependency-surface check

No new direct application dependency or new capability was introduced.
`package.json` changes only the existing exact Next pin (`15.0.5` ->
`15.5.20`) and exact-pins the already-existing TypeScript major at `5.9.3`.
The lockfile otherwise updates/removes existing transitive lines.

A set comparison does show new `@img/colour` plus optional Sharp binaries for
ppc64, riscv64, and Windows ARM64. These are normal replacement/platform
artifacts of the existing Next optional `sharp` dependency moving from
`0.33.5` to `0.34.5`; they do not create a new route, parser invocation, data
flow, network integration, or application-accessible package surface. Several
old parsing/support packages were removed (`busboy`, `streamsearch`,
`node-forge`, `color`, `color-string`, and related helpers). Spot-checking
therefore found no security-relevant expansion from the minor bump.

## 4. Source and behavior-change confirmation

The implementation commit changes only `package.json`, `package-lock.json`,
and the dependency-hardening spec/execution documents. `git diff` contains no
`src/**`, API route, auth/session, organization-membership, tenancy,
Firestore-rule/index, App Hosting, or Next configuration change. There is no
source-level behavior or authorization change; application behavior changes
only through patched dependency implementations.

Unrelated pre-existing workspace items (`HANDOVER.md`, `.claude/`,
`CLAUDE.md`, and `memory/`) were not reviewed as ticket changes and were not
modified by this Security review.

## 5. Offline rerun results

- `npm run lint` — **PASS**, exit 0, no ESLint warnings/errors. Next emitted
  only its lint deprecation and multi-lockfile workspace-root notices.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the documented **7
  baseline test-fixture errors** at `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No new
  M8-T5 or dependency-related error appeared.
- `npm test -- --run` — **PASS: 182 test files / 2,017 tests**. Existing React
  ref and development-secret warnings were emitted; no test failed.
- `git diff --check HEAD^ HEAD` — **PASS**.
- `npm audit` — **not run**, as explicitly required: this sandbox has no
  registry access. Before/after counts come from the authoritative
  Orchestrator-captured audit in
  `agents/docs/data-models/m8-dependency-hardening-execution.md`.

## Report-file confirmation

This report was written as the sole workspace modification made by the
Security Agent at `agents/docs/security/m8-dependency-hardening.md`.
