# Security Review — M3 Registration Paths & Public Flow

**Ticket:** m3-registration-paths
**Branch:** feat/m3-registration-paths (uncommitted working tree)
**Reviewer:** Security Agent
**Date:** 2026-07-10
**Verdict:** PASS (no Critical/High). 1 Medium + 3 Low, all non-blocking; recommend addressing the Medium before GA.

M3 introduces the platform's first **unauthenticated write endpoints** (public registration draft/quote/finalize). The design is unusually careful: capability-based access via signed, event-bound, hash-stored HMAC tokens; server-recomputed money on every step; strict Zod at every boundary; and both new Firestore collections deny-all. The public attack surface holds up. Findings below are hardening items, not exploitable breaks.

---

## Findings (most severe first)

### M-1 (Medium) — `DRAFT_TOKEN_SECRET` dev fallback is silently weak in production
**File:** `src/lib/draft-token.ts:37-52` (`resolveSecret`)

When `DRAFT_TOKEN_SECRET` is unset, the module falls back to a **hardcoded, source-committed** secret (`DEV_FALLBACK_SECRET`) and only emits a one-time `console.warn`. Production does **not fail loud** — a misconfigured deploy (missing/typo'd secret, secret not granted to the runtime service account) silently runs with a publicly known signing key.

**Exploitation scenario:** With the fallback secret an attacker can mint a valid signature for any `{draftId}.{eventId}`. The practical blast radius is limited by two independent layers — (a) `draftId` is 128 bits of `randomBytes` and never appears in URLs, and (b) `getAdminRegistrationDraftByIdAndTokenHash` additionally requires the stored SHA-256 token-hash to match — so forging access to a *specific victim's* draft still requires knowing that victim's random `draftId`. Hence Medium, not High. But a signing key that is defense-only should never depend on an env var being remembered.

**Remediation:** In production (`process.env.NODE_ENV === "production"`) throw at startup / first use when the secret is absent, instead of silently using the dev fallback. Keep the fallback strictly for `development`/`test`. The apphosting.yaml secret ref (below) is correct; this is about the code failing closed if the ref is ever missing.

---

### L-1 (Low) — Rate-limit IP extraction trusts the *first* `X-Forwarded-For` hop (spoofable)
**File:** `src/lib/rate-limit.ts:79-86` (`getRequestIp`)

`getRequestIp` returns the **left-most** `X-Forwarded-For` value. On GCP/App Hosting the true client IP is *appended* by the fronting proxy, and any client-supplied XFF is preserved to the left of it — so the left-most value is attacker-controlled. An attacker can rotate a fabricated `X-Forwarded-For: <random>` per request to land in a fresh per-IP bucket and defeat the limiter entirely.

This is explicitly documented in the module as best-effort and not a security boundary (the real boundary is Zod + the signed token), so it does not block. But the *first-hop* choice is the wrong one for spoof resistance.

**Remediation:** Parse XFF right-to-left and take the first entry that is not a known-trusted proxy hop (or, on App Hosting, use the platform-attached right-most client IP). Note the durable/shared limiter is already deferred to M8; this is a one-line correctness fix in the interim.

---

### L-2 (Low) — CSV formula-injection guard misses leading-whitespace and tab/CR lead bytes
**File:** `src/features/responses/csv.ts:19,22-31` (`escapeCsvField`, `FORMULA_PREFIX = /^[=+\-@]/`)

The guard prefixes `'` only when the cell *begins* with `= + - @`. It does not neutralize a leading whitespace/`\t`/`\r` followed by a formula char (e.g. `\t=cmd()`), which some spreadsheet apps trim-then-evaluate. Submission answer values are `.trim()`-ed by the form submission schema (`src/features/form/schema.ts:238-240`), which removes the common vector; but `eventName`/`ticketLabel` columns come from organizer-configured strings that are not trimmed here. Risk is low (those strings are org-trusted, not registrant-supplied), so this is hardening.

**Remediation:** Extend the pattern to also match a leading `\t`/`\r`/space before the formula char (`/^[\s]*[=+\-@]/` after deciding on a trim policy), keeping the RFC-4180 quoting as-is.

---

### L-3 (Low) — Stray `debug.log` files untracked in the tree (git hygiene)
**Files:** `debug.log`, `src/app/api/dashboard/events/[eventId]/pricing/taxes/debug.log`

Both are Chromium/crashpad stderr logs (no secrets), but they are untracked and sit under the source tree — one inside an API route directory — where they can be accidentally committed. Not a secrets leak.

**Remediation:** Delete them and add `debug.log` (and `**/debug.log`) to `.gitignore`. Not M3-scoped code, but flagged since they appear in this working tree.

---

## Verified secure (no action)

**Auth / tenancy**
- All dashboard mutating routes (registration-paths POST/PATCH/DELETE, status transition, per-event export) go through `resolveRegistrationRouteScope` = session → server-locked org membership (`resolveActiveOrganizationId`) → `write:events` → org-owned event. Cross-org ids collapse to 404 (IDOR-safe). Workspace export uses org-level `write:events` scope; per-event/workspace list GETs correctly drop to read-scope (membership only) matching the server page audience.
- Status transition PII/export scope: export is `write:events`-gated on both surfaces (`src/features/responses/server/route-scope.ts`); list reads are view-only. Adequate.

**Public flow — access & IDOR**
- Signed draft token is the sole capability: HMAC bound to `eventId`, constant-time verify (`verifyDraftToken` → `constantTimeStringEqual` over SHA-256 digests, length-hiding), **hash-only storage** (`draftTokenHash`), and a second constant-time hash check in the DAL. Forged/malformed/cross-event/hash-mismatch all return null → uniform 404 (`context.ts:84-99`, `adminRegistrationDraft.ts:104-119`). No `draftId`-only access path exists.
- Token transport is header/body only (`x-draft-token`), never URL — no referrer leakage. Client hook (`use-registration-draft.ts`, a `"use client"` file) references the token only by header name; it does **not** import `src/lib/draft-token.ts`, so the signing secret never enters the client bundle.
- `loadPublicRegistrationContext` re-gates every call: event Published, form published, path exists+active+org-scoped — all failures → single 404 shape (no event/path enumeration oracle).

**Money integrity**
- Client body for quote is advisory (ticket/regType re-resolved server-side); finalize body is `{ token }` only — `paymentMethod`/`currency`/amounts are Zod-stripped and sourced from the path doc (`finalize/route.ts:43-45,152-164`). Quote and finalize share identical fee/promo/tax resolution + `computeOrderTotals`; finalize re-validates transactionally with `PRICE_CHANGED` on drift.
- Double-submit/replay: deterministic order id + `idempotencyKey = reg:{draftId}:{attempt}`; `placeOrder` replays existing orders without re-charge, finalize transaction uses `tx.create` (racing double-submit loses cleanly, counters increment exactly once), provider is idempotent on the key. `attempt` bumps **only** on `PAYMENT_FAILED`. FormData create is create-if-absent at a draft-derived id; draft deleted only after Order **and** FormData exist. Failed payment returns 402 and never produces a FormData/success. Chain is sound.
- Forward-step gating: summary/payment PATCH markers require a completed ticket selection; payment marker rejected for comp/none paths or before summary. Finalize rejects missing selection pre-charge. Skipping UI steps cannot skip actual payment because `placeOrder` enforces method→status server-side regardless of `lastStepReached`.

**Promo secrecy**
- Every promo failure cause (unknown / code-less / inactive / not-started / expired / exhausted) collapses to the byte-identical `GENERIC_PROMO_ERROR` ("This code isn't valid.") + code `PROMO_INVALID` within each endpoint (quote 400, draft PATCH 400, finalize 409). Only `promotionId` is ever stored — promo code **text** never persists to the draft (`adminRegistrationDraft.ts` allow-list). No endpoint enumerates promotions.

**Input handling / limits**
- 32KB body cap enforced pre-parse by byte length (`readPublicJsonBody`), Zod with `.max()` caps and unknown-key stripping on every public route; step-1 answers validate against the form-derived schema (question fields only — commerce values excluded, `buildFormSubmissionSchema`).
- Commerce field rules server-enforced: single ticket-selector/promo-code per form, fixed keys, event-origin normalization on the transform (a tampered payload cannot smuggle a commerce field under another key), template schema rejects commerce types, and `applyTemplateToLinkedForm` filters commerce fields defensively.

**XSS**
- No `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` anywhere in `src`. Public flow renders event/path names, form labels/help text and confirmation refs through normal JSX (React auto-escaping). No template-injected HTML in the confirmation step; no email templating in M3.

**Status route / accept hook**
- Transition is transactional, tenant-checked (cross-org → NOT_FOUND/404), forward-only (`canTransitionFormDataStatus` strict-greater), `accepted` terminal → `onSubmissionAccepted` fires at most once. Hook is a no-op logging stub today; when M5 fills it with attendee creation it receives a server-read `WithId<FormDataDoc>` (not client input) — contract is safe, but M5 must treat `submission` values as untrusted at that point (note for M5 review).

**Secrets / config**
- `apphosting.yaml` adds `DRAFT_TOKEN_SECRET` as a **secret ref** (`secret: draftTokenSecret`), no literal, RUNTIME availability. `.env.local` is the only local env file and is not tracked. No secrets in the client bundle (server-only modules).

**Firestore rules**
- `RegistrationPath` and `RegistrationDraft` both `allow read, write: if false` — deny-all confirmed; all access via Admin-SDK routes. FormData remains server-only.
