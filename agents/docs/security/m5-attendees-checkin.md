# Security Review — M5 Attendees & Check-in (M5-T1..T5)

Security Agent, 2026-07-13. Scope: `git diff e561d4e..HEAD` + uncommitted working tree (S-1 fix: guarded accept hook in `src/lib/db/adminFormData.ts`, self-heal in `src/app/api/dashboard/events/[eventId]/attendees/register/route.ts`). Code review reference: `agents/docs/reviews/m5-attendees-checkin.md`.

## Verdict: PASS

No Critical or High findings. 1 Medium, 6 Low. The milestone may proceed to QA. The Medium is a pre-existing dependency-hygiene item recommended as a follow-up hardening ticket, not an M5 regression.

---

## Findings

### M-1 (Medium, pre-existing) — Outdated `next@15.0.5` and firebase-admin transitives carry known advisories
- **Tickets:** dependency hygiene (standard check)
- **Affected:** `package.json:26` (`next: 15.0.5`), transitive `@grpc/grpc-js`, `protobufjs`, `form-data` under `firebase-admin`
- **Detail:** `npm audit --omit=dev` reports 14 vulnerabilities (1 critical, 3 high). The critical/high set is concentrated in `next@15.0.5` (incl. GHSA-f82v-jwr5-mffw middleware authorization bypass, GHSA-4342-x723-ch2f SSRF via middleware redirects, several cache-poisoning/DoS advisories) and firebase-admin transitives (`@grpc/grpc-js` server-crash DoS, `protobufjs` DoS, `form-data` CRLF injection).
- **Exploitation:** The middleware advisories are **not directly exploitable here** — the app has no `middleware.ts` and performs all authorization inside route handlers/server pages. Remaining exposure is primarily DoS/cache-poisoning class.
- **New M5 packages are clean:** `qrcode@^1.5.4`, `qr-scanner@^1.4.2`, `@types/qrcode@^1.5.6` have no advisories.
- **Remediation:** Open a hardening ticket to bump `next` to the patched 15.5.x line and run `npm audit fix` for the grpc/protobufjs/form-data ranges. Non-blocking for M5 (pre-existing, unchanged by this diff).

### L-1 (Low, documented carry-over) — Rate limits are in-memory, per-instance
- **Tickets:** M5-T1 (token lookup), M5-T5 (session exchange, resolve/confirm)
- **Affected:** `src/lib/rate-limit.ts`; `src/app/api/events/[eventId]/checkin/session/route.ts:47` (10/min/IP); `src/features/checkin/server/scanner-session-scope.ts:59` (60/min/member); dashboard resolve/confirm (60/min/user)
- **Detail:** Fixed-window counters are per Cloud Run instance and reset on cold start, so the effective limit scales with instance count. Documented since M3 as a best-effort abuse dampener; the actual security boundary is the 140-bit access code (brute force infeasible at any request rate) and HMAC-signed tokens. XFF parsing correctly takes the rightmost non-private hop (prior S3/L-1 fix intact).
- **Remediation:** Keep the M8 durable-limiter hardening item on the backlog. No M5 action.

### L-2 (Low) — Manual-register route reads the body without a size cap
- **Ticket:** M5-T2
- **Affected:** `src/app/api/dashboard/events/[eventId]/attendees/register/route.ts:128` (`await request.json()`)
- **Detail:** Public routes cap bodies at 32KB via `readPublicJsonBody`; this authenticated route parses unbounded JSON. Zod caps individual key/value lengths (`z.record(z.string().max(200), z.string().max(5000))`) but not the number of keys, so a hostile-but-authenticated `write:events` user could post a very large record. Low: caller is already fully trusted for event mutation, and the form-derived schema then strips unknown keys before storage.
- **Remediation:** Reuse the 32KB-capped body reader (or an equivalent) on dashboard mutating routes for consistency.

### L-3 (Low) — Dead credential-lookup helper without org scoping
- **Ticket:** M5-T1
- **Affected:** `src/lib/db/adminAttendee.ts:185` (`getAdminAttendeeByQrTokenHash`)
- **Detail:** Unused by any route (only the deterministic-id path is used). Its query filters `eventId` + `qrTokenHash` but not `organizationId`, diverging from the DAL's own convention ("org id in every where()"). Harmless while dead; a risk seam if a future caller adopts it as a resolve path.
- **Remediation:** Delete it, or add `organizationId` to the query and a caller contract comment before first use.

### L-4 (Low, spec deviation) — Read surfaces gate on org membership, not `write:events`
- **Tickets:** M5-T2 / M5-T4
- **Affected:** `src/app/dashboard/(event)/events/[eventId]/attendees/page.tsx:64`, `src/app/dashboard/(event)/events/[eventId]/checkin/page.tsx:68`, `.../checkin/scan/page.tsx:25` (all via `getDashboardScope`)
- **Detail:** The spec's shared decision says every M5 admin surface gates `write:events`. The server pages gate on session + verified org membership only (M1–M3 read-surface convention); all API routes — including the GET roster/export/config routes and every mutation — do gate `write:events`. Net effect: a view-only member of the *same org* can see roster PII, abandoned rows (masked emails), config toggles, and team-member names/labels (never code material), but cannot mutate, export via API, or scan (dashboard scanner resolve/confirm 403 without `write:events`). No cross-tenant exposure.
- **Remediation:** Either amend the spec to record the read-surface convention, or add a `write:events` check to the M5 server pages. Product decision; not blocking.

### L-5 (Low) — Admin email disclosed to public door-scanner devices
- **Ticket:** M5-T5
- **Affected:** `src/features/checkin/server/resolve-scan.ts:83-90` (`checkedInByName` returns `checkedInBy.userId` — the lowercased admin email); surfaced in `ALREADY_CHECKED_IN` responses of the public route `src/app/api/events/[eventId]/checkin/confirm/route.ts:97-105`
- **Detail:** When an attendee was first checked in by the dashboard scanner, a duplicate scan on a *team-member* device shows the admin's email address. Door staff are semi-trusted (access-code holders), so this is internal-PII leakage to the least-trusted authenticated tier, not a tenant boundary break.
- **Remediation:** Return a display name or a generic "Organizer" label to team-mode scanners instead of the raw user id/email.

### L-6 (Low, invariant to preserve) — QR SVG rendered via `dangerouslySetInnerHTML`
- **Tickets:** M5-T1 / M5-T4
- **Affected:** `src/features/public-registration/components/confirmation-step.tsx:116`, `src/features/checkin/components/badge-preview-card.tsx:48`
- **Detail:** Safe as built: the SVG is generated **server-side** by `QRCode.toString(token, { type: "svg" })` from a token whose charset is fully server-controlled (Firestore ids + base64url HMAC; `mintQrToken` rejects ids containing `.`), and QR data is encoded as path geometry, not text nodes. There is no user-influenced string in the SVG. The pattern is only safe while that invariant holds.
- **Remediation:** Keep QR SVG generation exclusively server-side from minted tokens; never pass user-supplied strings into these `dangerouslySetInnerHTML` sinks. Consider a one-line comment at each sink stating the invariant (confirmation-step already documents the token; badge-preview relies on the page).

---

## Mandated checks — verified clean

**(a) M5-T1 QR token** (`src/lib/qr/qr-token.ts`): deterministic HMAC-SHA256 under `QR_TOKEN_SECRET`, unguessable without the secret; payload = `eventId.formDataId.sig` — **no PII** (asserted by `src/__tests__/qr-token.test.ts`); only SHA-256 hashes persisted (`FormDataDoc.qrTokenHash`, `AttendeeDoc.qrTokenHash`); verification constant-time via `constantTimeStringEqual`; resolve additionally re-checks the stored hash constant-time (`resolve-scan.ts:71`) as the revocation seam. Tokens travel in bodies only, never URLs. Lookup endpoints rate-limited (see L-1).

**(b) M5-T5 scan endpoints**: public resolve/confirm gate through one shared sequence (`scanner-session-scope.ts`): HMAC verify bound to the *route's* eventId (cross-event session tokens fail signature) → per-member rate limit → published-event + tenant re-derivation → `isActive` re-load (revocation immediate, T5 AC-9). Uniform 401 for expired/forged/revoked (no oracle). QR replay across events → `WRONG_EVENT` with zero attendee data; cross-org replay dead-ends at the deterministic (org, event, submissionId) id. Confirm is a transactional never-overwriting flip; `checkedInBy` identity is server-derived, never client-supplied; all resolution flows through the token — no bare attendeeId accepted (AC-12). Dashboard scanner routes gate `resolveRegistrationRouteScope` (`write:events`, 404 cross-org) + per-user rate limit. Access-code exchange: 140-bit server-minted codes, hash-only storage, one-time display, generic 401 for wrong/revoked/unknown codes and unknown events, constant-time hash re-check after the equality query.

**(c) Secret wiring**: `apphosting.yaml` adds `QR_TOKEN_SECRET`/`SCANNER_SESSION_SECRET` as Secret Manager references (RUNTIME only) — no values committed. Both modules (and the existing draft-token) fail closed in production (`NODE_ENV === "production"` throws when unset) and warn-once on the dev fallback otherwise. No server crypto module is imported by any `"use client"` file (verified: scanner components only carry the `scanner-session:` storage-key string); only pre-existing `NEXT_PUBLIC_*` values reach the browser. Diff scan found no committed secret material (test-only literals aside).

**(d) Firestore rules**: `firestore.rules` adds explicit deny-all matches for `Attendee/{attendeeId}`, `CheckinConfig/{eventId}`, `CheckinTeamMember/{teamMemberId}` — matches the server-only data model; no client repo pairs exist. DAL re-checks `organizationId`+`eventId` on every point read (`adminAttendee.ts:141`, `adminCheckinTeamMember.ts:92`, `adminCheckinConfig.ts:86/126`) and includes org in every list/count query. Composite indexes match the query shapes.

**(e) M5-T2/T3 PII + IDOR**: abandoned-tab emails are masked to domain-only **server-side** (`abandoned.ts:32`, `drafts/route.ts`) — the local part never crosses the boundary; only `isAbandoned` drafts are serialized. CSV export is `write:events`-gated, honors the status filter, bounded (1000), reuses the M3 `escapeCsvField` formula-injection guard, `Cache-Control: no-store`. Manual registration reuses the public `placeOrder` pipeline (capacity/pricing server-side), rejects card paths, validates the submission against the form-derived Zod schema, and self-heals orphaned accepts idempotently (S-1 fix verified: `transitionAdminFormDataStatus` surfaces `acceptHookFailed`, register route re-invokes the exported idempotent `onSubmissionAccepted` and 500s truthfully). All id-based access resolves through org+event-scoped getters returning null → 404 (IDOR-safe).

**Standard checks**: Zod at every new boundary (public routes additionally 32KB-capped); no unescaped user content rendered (React escaping; the two `dangerouslySetInnerHTML` sinks are server-generated QR SVGs — L-6); mutating dashboard routes ride the `SameSite=lax` session cookie (cross-site POST blocked) and public scanner mutations authenticate via body tokens (CSRF-immune); no open redirects introduced; no `console.log` in shipped M5 modules.
