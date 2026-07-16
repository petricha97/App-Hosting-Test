# Security Review — M7-T1 Reporting aggregates + event report summaries

Security Agent, 2026-07-17. Scope: all uncommitted changes in the working
tree relative to `prototype` under M7-T1 — new `src/features/reports/**`
(`types.ts`; `server/load-finance-summary.ts`,
`server/load-ticket-type-registrations.ts`; `components/reports-workspace.tsx`,
`components/reports-load-error.tsx`, `components/ticket-type-bar-chart.tsx`,
`components/ticket-type-bar-chart-card.tsx`, `components/finance-summary-card.tsx`),
new `src/app/dashboard/(event)/events/[eventId]/reports/loading.tsx`; modified
`src/lib/db/adminAttendee.ts` (`ticketTypeId` filter on
`countAdminAttendeesForEvent`), `src/lib/db/adminOrder.ts` (new
`sumAdminOrderTotalsForEvent`), `src/app/dashboard/(event)/events/[eventId]/reports/page.tsx`,
`src/features/event/event-nav.ts` (drop `comingSoon`),
`src/features/registration/components/entity-table-states.tsx` (additive `href`
prop on `EntityEmptyState`), plus test files. Reviewed against
`agents/docs/specs/m7-reporting-summaries.md` §7,
`agents/docs/data-models/m7-reporting-summaries.md`, and Code Review's
`agents/docs/reviews/m7-reporting-summaries.md` (APPROVED, 0 Blockers, 1
Should-fix, 3 Nits — none security-relevant).

Checks executed this session:
- `npm run lint` — PASS, exit 0, no warnings/errors.
- `npm run build` — PASS, exit 0. Route manifest confirms
  `/dashboard/events/[eventId]/reports` is the **only** new route added by
  this ticket — 3.93 kB / 127 kB First Load JS. **Zero new `/api/**` routes**
  appear anywhere in the manifest for this feature (grepped the full `ƒ /api/`
  route list — no `reports`-related entry exists at all), confirming the
  spec's own claim ("zero mutating routes... this ticket should have zero API
  routes at all") is actually true in the shipped code, not just asserted.
- `npm test -- --run` — PASS, **126 files / 1515 tests**, matching Code
  Review's count exactly.
- `npm audit` — 15 vulnerabilities (moderate/high/critical), all in the
  pre-existing `firebase-admin` → `@google-cloud/firestore` → `google-gax` →
  `teeny-request`/`retry-request`/`uuid` chain plus `websocket-driver` — the
  same baseline flagged by the M6-T1/M6-T2 security reviews as pre-existing
  and out of scope. `git diff package.json package-lock.json` is **empty** —
  confirms no new dependency was introduced by this ticket (matches spec §6
  AC-1's "no charting library needed" requirement and the data-model doc's
  "no dependency bump required" claim, both verified, not just trusted).

---

## 1. Permission gating — org-membership-only is correct, not an oversight

`src/app/dashboard/(event)/events/[eventId]/reports/page.tsx:27-44`:

```ts
const scope = await getDashboardScope();
...
event = await getAdminEventForOrganization(eventId, scope.organizationId);
...
if (!event) {
  notFound();
}
```

- `getDashboardScope()` (`src/features/dashboard/server/get-dashboard-scope.ts`)
  verifies the session server-side (`requireSessionUser`), then resolves the
  active `organizationId` from the **server-locked** `userDoc.organizations[]`
  roster (`resolveActiveOrganizationId`), explicitly *not* trusting a
  client-writable org-switcher value beyond membership confirmation (own
  code comment cites "SEC M2 Finding 1"). Unauthenticated/unscoped requests
  redirect to `/login` before any event data is touched.
- `getAdminEventForOrganization(eventId, scope.organizationId)`
  (`src/lib/db/adminEvent.ts:56-76`) fetches the event by id then calls
  `eventBelongsToOrganization(parsed, organizationId)` — returns `null` for
  any event outside the caller's org, triggering `notFound()`
  (`reports/page.tsx:42-44`), identical in shape to every other event
  sub-page (attendees, emails, checkin) in this codebase.
- No API route was added for this ticket at all (confirmed above via the
  build manifest) — so there is no mutating or read endpoint that could have
  skipped a `write:events` gate by mistake. The zero-API-route claim in the
  spec is empirically true in the shipped code.
- **Verdict: org-membership-only (`getDashboardScope()`, no `write:events`)
  is the correct, deliberate posture for this ticket**, not an oversight.
  Rationale, independently re-derived (not just copied from the spec):
  (a) M1–M6's `write:events` gate exists specifically to protect *mutating*
  routes, none of which exist here; (b) the data surfaced (counts, currency
  sums) is not individually identifying PII (see §3 below); (c) this matches
  the already-reviewed M5-L4 / M6-T2 §7 convention for read-only surfaces in
  this exact codebase, which Security has already accepted in two prior
  milestone reviews. Real Viewer-vs-Editor role separation is explicitly and
  correctly deferred to M8-T1 (real IAM), not silently dropped — the
  `UserPermission` enum exists in `src/types/collection.ts` but is genuinely
  not enforced anywhere per-route yet in this codebase (`iam-dashboard.tsx`
  is still mock data), so this ticket is not introducing a regression
  relative to the rest of the app's current state; it is holding the line at
  the same bar every other read surface already sits at.

## 2. Cross-org/cross-event isolation in the new aggregate DAL functions

**`countAdminAttendeesForEvent`** (`src/lib/db/adminAttendee.ts:263-292`):

```ts
let query = attendeeCol()
  .where("eventId", "==", input.eventId)
  .where("organizationId", "==", input.organizationId);
if (input.status !== undefined) query = query.where("status", "==", input.status);
if (input.checkInState !== undefined) query = query.where("checkInState", "==", input.checkInState);
if (input.ticketTypeId !== undefined) query = query.where("ticketTypeId", "==", input.ticketTypeId);
```

`eventId ==` and `organizationId ==` are **unconditional** — applied before
any of the optional filters and never inside an `if` branch. There is no
code path where an optional filter (`ticketTypeId`, `status`,
`checkInState`) can replace, short-circuit, or widen the mandatory
tenant/event scope; each additional filter can only ever narrow the result
set further via Firestore's AND-only equality-filter semantics. An
empty-string or garbage `ticketTypeId` (`ticketTypeId: ""`) simply adds
`ticketTypeId == ""` to the query — since no real attendee doc has that
value, it deterministically returns `0`, never a wider/looser scope; it
cannot be used to bypass or invert the `eventId`/`organizationId` filters
(Firestore has no OR-widening or filter-negation vector here — `where`
clauses only ever narrow with AND-composition in this SDK usage).

**`sumAdminOrderTotalsForEvent`** (`src/lib/db/adminOrder.ts:227-244`): same
shape — `eventId ==`, `organizationId ==`, `paymentStatus ==`, `currency ==`
are **all** unconditional (no optional filters at all in this function; every
parameter is required), so there is no filter-omission edge case to exploit
in the first place. `paymentStatus: PaymentStatus` and `currency: Currency`
are both closed TypeScript literal unions (`src/types/collection.ts:358,415`),
not free-form strings — even if a caller wanted to pass an attacker-supplied
value, TypeScript rejects anything outside the enumerated set at compile
time, and in practice neither loader ever receives a value from client
input (see next paragraph).

**Client input never reaches either function.** Both are called exclusively
from server-only orchestration files (`import "server-only";` at the top of
both `load-finance-summary.ts` and `load-ticket-type-registrations.ts`),
themselves called only from the Server Component `reports/page.tsx`, whose
`eventId`/`organizationId` inputs are: `eventId` from the Next.js route
param (already re-validated against `organizationId` via
`getAdminEventForOrganization`'s cross-org check before either loader runs),
and `organizationId` from `scope.organizationId` (session-derived, per §1
above) — never from a request body, query string, or any other
client-supplied field. `currency` values passed into
`sumAdminOrderTotalsForEvent` are enumerated server-side from the event's own
`RegistrationPath.currency` field (`load-finance-summary.ts:94-96`), and
`paymentStatus` values are hardcoded literals (`"paid"`, `"outstanding"`,
`"comped"`) in `loadCurrencySection` (`load-finance-summary.ts:48,55,64`) —
neither is influenced by any external actor.

Both isolation claims are also locked by dedicated tests per the data-model
doc (`admin-order-finance-sums.test.ts` cross-org/cross-event isolation
case, `admin-attendee.test.ts`'s new `ticketTypeId` block's "never leaks
cross-org or cross-event attendees" case) and by Backend's own empirical
Firestore-emulator verification (a different-`eventId` order's amount was
confirmed not to leak into another event's sum).

**Verdict: no cross-org data leakage vector found in either new/extended DAL
surface.**

## 3. PII / financial data exposure — aggregate-only, no leak path found

- Every value rendered on this screen is either a `count()` or `sum()`
  Firestore aggregate result (a single `number`), or a ticket type's own
  `name` (organizer-authored metadata, not attendee PII) — confirmed by
  reading every component in `src/features/reports/components/**`:
  `finance-summary-card.tsx` renders only `formatMoney(section.*Minor, ...)`
  and `String(count)`; `ticket-type-bar-chart.tsx` renders only `row.label`
  (ticket type name) and `row.count`. No component in this feature ever
  receives or renders an `Attendee` or `Order` document, an email address, a
  name, or a line-item.
- **Error messages do not echo raw documents.** Both card-level error panels
  (`EntityTableError`, `ReportsLoadError`) render static, generic copy
  ("Couldn't load {entityLabel}" / "Something went wrong on our side")
  regardless of the underlying thrown error — no `error.message` or
  `error` object is ever interpolated into UI text anywhere in
  `src/features/reports/**` or `reports/page.tsx` (both `catch` blocks
  discard the caught value and only flip a boolean flag).
- **No debug/console logging with financial data.** `grep -rn "console\."`
  across `src/features/reports/` returns zero hits.
- **Discount-codes-used** deliberately reads `usedCount >= 1` as a boolean
  count over the small, already-bounded `EventPromotion` list
  (`load-finance-summary.ts:112-116`) — it never surfaces which specific
  code, its discount value, or which order(s) redeemed it; this matches
  spec §2's own definition exactly (count of distinct codes, not a listing).
- Every org member (any role, per §1's already-accepted posture) can see
  these aggregates — that is the intentional, spec-documented scope for
  T1 (§7), not a defect of this review.

**Verdict: no PII or individually-identifying financial detail is exposed
through this surface; all values are genuine aggregates.**

## 4. `EntityEmptyState`'s new `href` prop — not an open-redirect vector

`src/features/registration/components/entity-table-states.tsx:120-123`:

```tsx
{actionLabel && href ? (
  <Button asChild><Link href={href}>{actionLabel}</Link></Button>
) : ...}
```

- `href` is a plain optional `string` prop with **no caller in the entire
  codebase** passing anything other than a hardcoded, same-origin template
  literal: `` `/dashboard/events/${encodeURIComponent(eventId)}/registration-paths` ``
  (`finance-summary-card.tsx:103`) and
  `` `/dashboard/events/${encodeURIComponent(eventId)}/tickets` ``
  (`ticket-type-bar-chart-card.tsx:47`) — confirmed via
  `grep -rn "href=" src/features/reports/`, both call sites, no others.
- Even in the hypothetical worst case where `eventId` itself were attacker
  -influenced, `encodeURIComponent` percent-encodes it into a single path
  segment (any `/`, `//`, or protocol-like content such as `https://evil.com`
  gets encoded to inert characters, e.g. `%2F%2Fevil.com`), and the resulting
  string is always appended after a hardcoded `/dashboard/events/` prefix —
  there is no way for the interpolated value to escape into a different
  origin or a `javascript:`/`data:` scheme; Next.js's `<Link href>` also only
  ever renders an `<a href>` to that literal same-origin string, no client
  redirect logic re-parses it. In practice `eventId` here is the same
  route-param value already cross-org-checked by `getAdminEventForOrganization`
  before either card ever renders, so it isn't even attacker-influenced in
  the first place.
- No other caller of `EntityEmptyState` in the codebase was changed to use
  `href` — all pre-existing call sites keep `onAction`, unaffected.

**Verdict: `href` cannot be abused as an open-redirect vector; it is always
a hardcoded internal path template, never user/organizer-controlled input.**

## 5. Secrets / dependencies

- No new npm dependency (`git diff package.json package-lock.json` empty) —
  matches spec §6 AC-1 ("no charting library needed") and the data-model
  doc's confirmation that `count()`/`sum()` aggregate support already exists
  in the pinned `firebase-admin`/`firebase` versions.
- `npm audit` shows the same 15 pre-existing findings in the
  `firebase-admin`/`@google-cloud/firestore`/`google-gax` chain and
  `websocket-driver` already flagged as pre-existing/out-of-scope by the
  M6-T1/M6-T2 security reviews — nothing new introduced by this ticket.
- No secret, API key, or service-account material appears anywhere in the
  new `src/features/reports/**` files (grepped for common patterns; all new
  files are pure presentation/orchestration code with no `process.env`
  reads at all — this feature needs none).
- No `NEXT_PUBLIC_*`-boundary concern: all new server-only files
  (`load-finance-summary.ts`, `load-ticket-type-registrations.ts`) correctly
  carry `import "server-only";`, preventing any accidental client-bundle
  inclusion of admin-SDK-adjacent code.

---

## Findings

**None. No Critical, High, Medium, or Low findings in this review.**

This ticket's own code-review-flagged Should-fix (S-1, missing a
concurrency-specific test for spec §3 AC-2) and three Nits are test-coverage
/ polish items already triaged as non-gating by Code Review and are not
security-relevant (they concern test rigor around already-correct
`Promise.all` usage, visual regression coverage, and diff hygiene — none
touch authorization, tenancy, injection, or data exposure).

---

## Verdict

| Ticket | Verdict | Severity counts |
|---|---|---|
| M7-T1 — Reporting aggregates + event report summaries | **PASS** | Critical: 0, High: 0, Medium: 0, Low: 0 |

**Conclusion on the permission-gating question:** org-membership-only
gating via `getDashboardScope()` (no `write:events` check) is the **correct**
posture for this ticket, not an oversight. This is genuinely a pure read
surface with zero mutating routes (independently confirmed via the build's
route manifest, not merely trusted from the spec), the data it exposes is
aggregate counts/sums rather than individually-identifying PII or raw
financial line items, and the IDOR/tenancy shape
(`getDashboardScope()` → `getAdminEventForOrganization` → `notFound()`) is
byte-for-byte identical to every other already-reviewed read surface in this
codebase (M5 attendees, M6 emails). Both new DAL aggregate functions
(`countAdminAttendeesForEvent`'s `ticketTypeId` filter,
`sumAdminOrderTotalsForEvent`) scope every query by unconditional
`eventId ==` + `organizationId ==` filters with no filter-omission or
filter-widening edge case, and receive their inputs exclusively from
server-derived values (session + already-cross-org-checked route param),
never from untrusted client input. The ticket proceeds to the QA Agent.
