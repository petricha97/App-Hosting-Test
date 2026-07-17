# Security Review — M7-T2 Report templates library

Security Agent, 2026-07-17. Scope: all uncommitted changes in the working
tree relative to `prototype` under M7-T2 — new `src/features/reports/`
(`templates.ts`, `csv.ts`; `server/reports-route-scope.ts`,
`server/report-run-handler.ts`, `server/report-export-loop.ts`,
`server/resolve-type-names.ts`, `server/load-registration-overview.ts`,
`server/load-order-transactions.ts`, `server/load-abandoned-registrations.ts`,
`server/load-checkin-history.ts`, `server/load-email-overview.ts`;
`components/report-templates-section.tsx`, `components/report-templates-table.tsx`,
`components/report-run-panel.tsx`); 10 new API routes under
`src/app/api/dashboard/events/[eventId]/reports/<slug>/{route.ts,export/route.ts}`;
modified `src/lib/db/adminOrder.ts` (`getAdminOrdersForEvent` cursor
extension), `src/features/attendees/roster.ts` (`buildName()` exported,
additive), `src/features/reports/types.ts` (additive `ReportRow`/`ReportPage`),
`src/features/reports/components/reports-workspace.tsx` (additive
`ReportTemplatesSection` mount). Reviewed against
`agents/docs/specs/m7-report-templates.md` (D1–D6), `agents/docs/design/m7-report-templates.md`,
`agents/docs/data-models/m7-report-templates.md`, and Code Review's
`agents/docs/reviews/m7-report-templates.md` (APPROVED, 0 Blockers, 0
Should-fix, 3 Nits — none security-relevant). This review independently
re-derives every finding from source rather than trusting Code Review's
conclusions, per the ticket's own explicit instruction (D1's own framing:
Security's job is verifying correct enforcement of an already-chosen gate,
not re-trusting a prior pass).

Checks executed this session:
- `npm run lint` — PASS, exit 0, no warnings/errors.
- `npx tsc --noEmit --pretty false` — PASS, clean except the same
  **pre-existing, unrelated** baseline errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, `register-route.test.ts:62` — none
  touch any file in this diff's scope, matching Code Review's claim exactly.
- `npm run build` — PASS, exit 0. `/dashboard/events/[eventId]/reports`
  appears at 8.49 kB / 140 kB First Load JS, matching Code Review's number.
- `npm test -- --run` — PASS, **137 files / 1581 tests**, matching Code
  Review's reported numbers exactly.
- `npm audit` — 24 vulnerabilities (dev+prod combined), all pre-existing in
  the `firebase-admin` → `@google-cloud/firestore` → `google-gax` →
  `teeny-request`/`retry-request`/`uuid` chain, `@measured/puck`'s own `uuid`
  dependency, `vite`/`vitest` (dev-only), and `websocket-driver` — the same
  baseline chain flagged pre-existing by every prior milestone's security
  review. `git diff package.json package-lock.json` is **empty** — confirms
  no new dependency was introduced by this ticket.

---

## 1. The D1 permission split — independently re-derived from all 10 route.ts files, not from Code Review's claim

Read every one of the 10 `route.ts` files directly (not the shared handlers
alone):

| Route file | Handler called |
|---|---|
| `registration-overview/route.ts:13` | `handleReportRunRequest` |
| `registration-overview/export/route.ts:16-21` | `handleReportExportRequest` |
| `order-transactions/route.ts:13` | `handleReportRunRequest` |
| `order-transactions/export/route.ts:16-21` | `handleReportExportRequest` |
| `abandoned-registrations/route.ts:12-18` | `handleReportRunRequest` |
| `abandoned-registrations/export/route.ts:15-22` | `handleReportExportRequest` |
| `checkin-history/route.ts:13` | `handleReportRunRequest` |
| `checkin-history/export/route.ts:16-21` | `handleReportExportRequest` |
| `email-overview/route.ts:13` | `handleReportRunRequest` |
| `email-overview/export/route.ts:16-21` | `handleReportExportRequest` |

Zero reversed wiring — every Run route calls the org-membership-only
handler, every export route calls the `write:events`-gated handler.

`resolveReportsRouteScope()` (`src/features/reports/server/reports-route-scope.ts:35-79`):
- `requireWriteEvents` defaults to `false` (`:37`) — a caller must opt in
  explicitly; Run routes never accidentally inherit the stricter gate.
- `handleReportRunRequest` (`report-run-handler.ts:25`) calls it with no
  options object. `handleReportExportRequest` (`:61-63`) calls it with
  `{ requireWriteEvents: true }` explicitly.
- **Server-side re-derivation of tenancy, not client-trusted:** the
  `organizationId` used for every downstream query is
  `resolveActiveOrganizationId(userDoc)` (`:55`), which only trusts
  `userDoc.organizationId` when the server-locked `userDoc.organizations[]`
  roster confirms active membership (`src/lib/org-membership.ts:52-58`,
  carrying forward the SEC M2 Finding 1 fix, unmodified shared code already
  vetted in every prior milestone's review). A client cannot widen or spoof
  its org scope via any request parameter — `eventId` is the only
  client-supplied value, and it is checked *against* the server-derived org,
  never used to derive the org.
- 404-on-cross-org: `getAdminEventForOrganization(eventId, organizationId)`
  (`:73`) returns `null` for any event outside the caller's org, and the
  route returns a plain `404` — event existence never leaks across tenants,
  identical in shape to `resolveRegistrationRouteScope()`.
- End-to-end confirmation (not just my own reading): `reports-run-export-routes.test.ts`
  drives the real `registration-overview` route pair through a mocked
  session — the same org member gets `200` on Run and `403` on export
  (`:154-164`), and a `write:events` member gets `200` with the correct
  filename on export (`:166-185`); cross-org returns `404` on both (`:138-150`, `:187-202`).
  `reports-route-scope.test.ts` independently locks the 401/403/404 ladder
  and the `requireWriteEvents` true/false split at the helper level.

**Verdict: D1's permission split genuinely holds, verified independently
file-by-file — no gap.**

## 2. Order & transaction details — the new PII/financial exposure class

**(a) No internal-only `OrderDoc` field leaks.** `OrderDoc`'s full field set
(`src/types/collection.ts:454-475`): `organizationId`, `eventId`,
`submissionId`, `ticketTypeId`, `registrationTypeId`, `feeId`, `promotionId`,
`taxIds`, `currency`, `amounts`, `snapshot`, `paymentMethod`,
`paymentStatus`, `paymentProvider` (`"simulated"`), `providerPaymentId`,
`idempotencyKey`, `createdAt`, `updatedAt`.

`serializeRow()` (`src/features/reports/server/load-order-transactions.ts:30-53`)
maps exactly: `doc.id`, `submissionId`, resolved ticket/registration type
names, `snapshot.feeName`, `currency`, formatted `amounts.*`,
`snapshot.promoCode`, `paymentMethod`, `paymentStatus`,
`providerPaymentId`, `createdAt`. Independently confirmed by direct read
(not by grep-for-absence alone) that the function body never references
`doc.idempotencyKey`, `doc.paymentProvider`, `doc.feeId`, `doc.taxIds`, or
`doc.promotionId` anywhere. `templates.ts`'s `order-transactions` column
list (`:102-118`) has exactly 15 keys, matching `serializeRow`'s output keys
1:1 — no column configuration could pull an unlisted field into the CSV
even if `serializeRow` ever added one by mistake (`buildReportCsv` only
projects `row[column.key]`, `src/features/reports/csv.ts:25-27`).

**(b) Cross-org isolation on the new `getAdminOrdersForEvent` cursor path
is structural, not cursor-dependent.** Read the actual diff
(`src/lib/db/adminOrder.ts`):

```ts
let query = orderCol()
  .where("eventId", "==", input.eventId)
  .where("organizationId", "==", input.organizationId)
  .orderBy("createdAt", "desc");

if (input.startAfterCreatedAtMs !== undefined) {
  query = query.startAfter(Timestamp.fromMillis(input.startAfterCreatedAtMs));
}
```

The `startAfter` cursor is chained **after** both mandatory equality filters
are already applied to the query builder — there is no code path where the
cursor could be used to widen or bypass the `eventId`/`organizationId`
scope; Firestore's query-builder semantics compose filters with AND only.
`organizationId` itself is always the server-derived value from
`resolveReportsRouteScope`, never client-supplied (§1 above), so a same-
timestamp row in a different org can never be reached by manipulating the
`?cursor=` query parameter. Locked by `admin-order-list.test.ts:154-170`
(same-timestamp cross-org seed, confirmed absent from the cursor-paged
result).

**(c) The exported CSV genuinely never carries `idempotencyKey`, and the
one field that IS derived from it is a one-way hash, not a reversible
encoding.** The `Order ID` column is `doc.id`, which — per
`src/lib/orders/order-id.ts` — is
`sha256(JSON.stringify([organizationId, eventId, idempotencyKey]))`, a
one-way cryptographic hash (`createHash("sha256")...digest("hex")`, no
decode path exists anywhere in this codebase). Exposing this hash in the
CSV does **not** leak the underlying `idempotencyKey` value: SHA-256 is not
invertible, and even a brute-force attempt would need to already know (or
guess) the exact idempotency key string, which is generated client-side at
checkout time and never stored/derivable from the hash. The hash also
cannot be replayed to "create" a duplicate order in this app's own
create-if-absent transaction, because that transaction keys off the **raw**
`idempotencyKey` value supplied at request time (`adminOrder.ts:307-342`),
not off the document id — knowing `doc.id` alone gives no create-if-absent
capability. This matches the field's own doc comment
(`agents/docs/specs/m7-report-templates.md` §2 column spec: "Opaque
deterministic hash... not a secret — no capability is derivable from it").

**One test-coverage gap, not a live vulnerability (see Low-1 below):** no
automated test in `report-order-transactions.test.ts` asserts the *absence*
of `idempotencyKey`/`paymentProvider` from the row/CSV output (the fixture
seeds these fields at `:79,81` but nothing greps the output for them) — this
review's conclusion above rests on direct source reading (confirmed
independently, not copied from Code Review), which is sound, but a future
refactor that replaces the explicit field list with an object spread would
not be caught by any regression test today.

**Verdict: no internal-only field leak, cross-org isolation is structural,
and the one hash-derived field carries no replay/capability risk.**

## 3. D4 masked-email — no leak path, including in the CSV bytes themselves

`load-abandoned-registrations.ts`'s `serializeRow()` (`:41-64`) builds a
`ReportRow` with key `maskedEmail: maskEmailDomain(item.email ?? "")` — the
raw `item.email` value is **never** assigned to any other key, logged, or
returned. `templates.ts`'s `abandoned-registrations` column list (`:136-143`)
uses only the `maskedEmail` key — no column configuration references a raw
`email` key for this template, so `buildReportCsv`'s
`row[column.key]` projection (`csv.ts:25-27`) has no path to pull a raw
address into the file even if `serializeRow` accidentally computed one
somewhere.

Read the actual CSV-row-building code, not just the loader: `buildReportCsv`
takes the already-serialized `ReportRow[]` (produced by the identical
`serializeRow` function for both Run and export — `loadAbandonedRegistrationsPage`
and `loadAbandonedRegistrationsExport` both call it, `:56` and `:136`) and
only ever reads `row[column.key]` for the columns configured in
`templates.ts`. Since `"email"` is never a configured column key for this
template, there is no code path — CSV or JSON — through which the raw local
part could reach the client. Locked by dedicated tests scanning the
**entire serialized output**, not just the masked field: `report-abandoned-registrations.test.ts:90-101`
(`JSON.stringify(page.rows)` must not contain the seeded raw address) and
`:130-141` (same assertion on the export path). Independently re-verified
by reading the actual `serializeRow`/`buildReportCsv` chain end-to-end, not
by re-reading Code Review's conclusion.

**Verdict: D4 holds — no raw-email leak path in Run, export JSON, or the
CSV bytes.**

## 4. CSV formula injection — already handled, pre-existing, not a new gap

`buildReportCsv()` (`src/features/reports/csv.ts:19-32`) imports
`escapeCsvField` directly from `@/features/responses/csv` (`:5`) — no local
re-implementation anywhere in `src/features/reports/`. `escapeCsvField`
itself (`src/features/responses/csv.ts:26-35`):

```ts
const FORMULA_PREFIX = /^\s*[=+\-@]/;
const NEEDS_QUOTING = /[",\r\n]/;

export function escapeCsvField(value: string): string {
  let field = value;
  if (FORMULA_PREFIX.test(field)) {
    field = `'${field}`;
  }
  if (NEEDS_QUOTING.test(field)) {
    field = `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}
```

This **is** a genuine formula-injection guard (distinct from, and applied
before, the RFC-4180 comma/quote escaping) — cells beginning with `=`, `+`,
`-`, or `@` (even behind leading whitespace, per the function's own L-2
comment) are prefixed with `'` so Excel/Sheets treats them as text, not a
formula. This is **pre-existing code from M3-T4** (the Responses export),
already reviewed in that milestone — this ticket reuses it verbatim and
adds zero new escaping logic. Confirmed by test: `report-templates-csv.test.ts:154-173`
seeds a `Company` value starting with `=SUM(...)` combined with a
comma+quote and asserts the exact escaped output (`'=SUM(A1)` prefix, then
RFC-4180 quoting applied on top).

**Verdict: no CSV-formula-injection gap. The guard exists, is applied to
every column of every one of the 5 new templates, and is inherited,
already-reviewed scope — not new risk introduced by this ticket.**

## 5. Rate limiting — a real, non-blocking gap; diverges from the M6 convention for authenticated expensive/mutating routes

**Finding: zero rate limiting on any of the 10 new report routes.**
`grep -rn "rateLimit\|RateLimit\|checkRateLimit"` across
`src/features/reports/**` and
`src/app/api/dashboard/events/[eventId]/reports/**` returns no hits.
Neither `resolveReportsRouteScope()`, `handleReportRunRequest`, nor
`handleReportExportRequest` calls `checkRateLimit`/`checkRequestRateLimit`
(`src/lib/rate-limit.ts`) anywhere.

**This diverges from the established M6 convention**, not just from a
generic best practice: every authenticated M6 dashboard mutating/expensive
route this repo shipped applies per-user rate limiting even though the
route is already session + `write:events` gated —
`src/app/api/dashboard/events/[eventId]/drafts/email-all/route.ts:49-60`
(`checkRateLimit(`emails-email-all:${scope.userId}:${eventId}`, { limit: 10 })`),
and the same pattern in `emails/test-send/route.ts`, `emails/settings/route.ts`,
`emails/preview/route.ts`, `emails/definitions/route.ts`,
`emails/definitions/[kind]/route.ts`, `emails/messages/[messageId]/retry/route.ts`,
`checkin/resolve/route.ts`, and `checkin/confirm/route.ts` (9 authenticated
routes total, confirmed by grep). The rate-limit convention in this
codebase is explicitly **not** reserved for unauthenticated public routes —
it is applied wherever a route performs an operation worth throttling per
authenticated caller, and every one of these 5 new export routes performs
exactly that class of operation: a bounded-but-real Firestore read of up to
1000 documents per call (up to **4,000** raw `RegistrationDraft` reads in
the Abandoned template's worst case, per spec D2/§3's own documented
two-ceiling loop), synchronously, in a single request.

**Exploitation scenario:** any org member who holds (or has ever held)
`write:events` — including a compromised legitimate account, or an insider
with no economic reason to abuse their own access — can call any of the 5
export endpoints in a tight loop with no server-side throttle, each call
triggering up to 1000 (or 4,000, for Abandoned) Firestore document reads.
Repeated at, say, one call per second sustained, this is a genuine
Firestore-cost-amplification and latency-degradation vector with no circuit
breaker anywhere in the request path. This is materially higher-volume per
call than the two pre-existing sibling export routes
(`attendees/export/route.ts`, `responses/export/route.ts`) this ticket's
own spec (D1/D2) explicitly modeled itself on — and those two routes are
**also** unthrottled today (confirmed by grep), so this is not a new
regression introduced in isolation by M7-T2; it perpetuates an existing gap
in the "GET export route" family specifically, while the more recently
shipped M6 "POST mutating/expensive route" family already closed the
equivalent gap for itself.

**Severity: Medium.** Not Critical/High because: (a) the endpoint is
already gated behind `write:events`, meaning exploitation requires an
already-privileged (or compromised-privileged) account, not an anonymous
or under-privileged actor; (b) each individual call is itself bounded
(≤1000 rows, ≤4,000 raw reads, single synchronous request/response, no
fan-out); (c) it does not expose additional data beyond what a single
authorized call already can — the risk is purely operational cost/DoS, not
a new data-exposure or authorization-bypass vector. It is a real,
concrete, remediable gap worth fixing (recommend before this app carries
production traffic at meaningful scale), not a theoretical one.

**Remediation:** apply the exact same `checkRateLimit` pattern already
proven in `drafts/email-all/route.ts` to `handleReportExportRequest`
(`src/features/reports/server/report-run-handler.ts:50-81`) — e.g.
`checkRateLimit(`reports-export:${scope.organizationId}:${eventId}:${slug}`, { limit: N })`
inside the shared handler (one change point covers all 5 export routes,
matching this ticket's own "one handler, thin route wrappers" design). A
lower-priority companion fix: apply the same pattern to the two pre-existing
sibling export routes this ticket cites as precedent, since they share the
identical gap and the same remediation shape.

## 6. Secrets / dependencies

- No new npm dependency (`git diff package.json package-lock.json` empty),
  confirmed directly, not assumed from the spec's claim.
- `npm audit` shows the same pre-existing `firebase-admin`/`@google-cloud/firestore`/`google-gax`/`uuid`
  chain, `@measured/puck`'s own transitive `uuid`, `vite`/`vitest` (dev-only),
  and `websocket-driver` findings already flagged as pre-existing and
  out-of-scope by every prior milestone's security review (M6-T1 through
  M7-T1) — nothing new introduced by this ticket.
- No secret, API key, or service-account material in any new
  `src/features/reports/**` file; every server-only loader/route carries
  `import "server-only"` (`reports-route-scope.ts:15`, `report-run-handler.ts:6`,
  `report-export-loop.ts:14`, every `load-*.ts` file, `resolve-type-names.ts:7`),
  preventing accidental client-bundle inclusion of admin-SDK-adjacent code.
  `templates.ts` (imported by both client and server code, per its own
  header comment) is confirmed pure data — no Firebase import, no
  `process.env` read.
- No `NEXT_PUBLIC_*` boundary concern — this feature reads no environment
  variables at all.

## 7. XSS / rendering — no injection vector in the new Run table

`report-run-panel.tsx` renders every cell via plain JSX text interpolation
(`{display}`, `:239-241`) — no `dangerouslySetInnerHTML`/`innerHTML`
anywhere in `src/features/reports/**` (confirmed by grep, zero hits). React
auto-escapes all interpolated text, so an attendee/company/name field
containing HTML markup renders as inert text, not markup — this surface
carries no Puck-adjacent rendering risk (no page-builder content is ever
loaded by this feature).

---

## Findings

### Medium

- **M-1 — No rate limiting on any of the 5 new export routes (§5 above).**
  `src/features/reports/server/report-run-handler.ts:50-81`
  (`handleReportExportRequest`), consumed by all 5
  `.../reports/<slug>/export/route.ts` files. Diverges from the M6
  convention of rate-limiting authenticated expensive/mutating routes even
  behind an already-correct permission gate. Not a data-exposure or
  authorization-bypass issue — a cost/availability gap. **Should-fix before
  this ships to production traffic at scale; does not block this ticket's
  progression to QA** per this review's severity policy (Medium does not
  block).

### Low

- **L-1 — No automated regression test asserts the literal absence of
  `idempotencyKey`/`paymentProvider` from the Order & transaction details
  output (§2(a) above).** `src/__tests__/report-order-transactions.test.ts`
  seeds both fields in its fixture (`:79,81`) but never asserts they are
  absent from `serializeRow`'s output or the built CSV. This review's
  conclusion that no leak exists rests on direct, independent source
  reading (confirmed sound), but a future refactor (e.g. replacing the
  explicit field list with `{...doc}` spread) would not be caught by any
  test today. Recommend a `JSON.stringify(rows)` containment-style
  assertion mirroring the D4 masked-email tests' own pattern
  (`report-abandoned-registrations.test.ts:90-101`).
- **L-2 — Same rate-limiting gap (M-1) exists on the two pre-existing
  sibling export routes** (`attendees/export/route.ts`,
  `responses/export/route.ts`) this ticket's spec explicitly cites as
  precedent — noted here for completeness since M-1's remediation is a
  natural place to close both at once, not because this ticket introduced
  that pre-existing gap.

### Informational (already covered by Code Review's nits, not re-flagged as new)

- Code Review's N-1 (CSV-parser round-trip test uses string-containment,
  not a real parser — inherited from M3-T4, no CSV-parser library exists in
  this repo), N-2 (array-index React key on report rows — no correctness
  risk, rows only ever append), and N-3 (only 1 of 5 route pairs has an
  end-to-end test; compensated by this review's own file-by-file reading of
  all 10 routes, §1 above) are non-security findings already triaged by
  Code Review — no independent security concern in any of the three.

---

## Verdict

| Ticket | Verdict | Severity counts |
|---|---|---|
| M7-T2 — Report templates library | **PASS** | Critical: 0, High: 0, Medium: 1, Low: 2 |

**Conclusion.** The ticket's two central, explicitly-flagged security
decisions both hold under independent re-derivation: (1) **D1's permission
split is correctly enforced across all 10 routes**, verified file-by-file
from source, not from Code Review's claim — every Run route gates on org
membership only, every export route gates on `write:events`, with the
underlying `resolveReportsRouteScope()` re-deriving tenancy server-side via
the same already-vetted `resolveActiveOrganizationId()` pattern every other
route in this codebase uses (no client-trusted org id anywhere). (2) **The
Order & transaction details template — the first UI surface ever to render
individual `Order` docs — carries no internal-only field.** No
`idempotencyKey`, no `paymentProvider`, no raw `feeId`/`taxIds`/`promotionId`
anywhere in the Run or export output; the one hash-derived field (`Order
ID`) is a one-way SHA-256 digest with no capability or reversibility
implication. (3) **D4's masked-email rule has no leak path**, confirmed by
reading the actual CSV-row-building code end-to-end (not just the loader):
the `abandoned-registrations` template's `ReportRow` shape carries only
`maskedEmail`, and no column configuration ever requests a raw `email` key,
so the raw local part cannot reach the client via Run, export JSON, or the
CSV bytes, in any code path. (4) **CSV formula injection is already
guarded** via the pre-existing, M3-T4-reviewed `escapeCsvField`, reused
verbatim by all 5 new templates — not a gap, new or inherited.

The one real, concrete finding from this independent pass that Code Review
did not surface is **M-1: none of the 10 new routes, especially the 5
export routes performing up to 1000 (or 4,000, for Abandoned) Firestore
reads per call, have any rate limiting**, diverging from the M6 convention
of throttling authenticated expensive/mutating routes even behind a correct
permission gate. This is a Medium-severity, non-blocking finding — remediate
before production-scale traffic, but it does not gate this ticket's
progression to QA. Two Low findings (a test-coverage gap around
`idempotencyKey` absence, and the same rate-limiting gap on two
pre-existing sibling export routes) are noted for follow-up.

The ticket **proceeds to the QA Agent**.
