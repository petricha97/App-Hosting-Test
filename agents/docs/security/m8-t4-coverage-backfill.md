# Security Review — M8-T4 Coverage Backfill and Tenancy Fixes

## Re-review (2026-07-19)

### New gate result — PASS

**PASS — 0 Critical / 0 High / 1 Medium / 0 Low open findings.** Both High
cross-tenant findings are closed. The remaining Medium operational-atomicity
finding is accepted as non-blocking for this gate and is tracked as M8-T9.

| Severity | Open count | Re-review status |
|---|---:|---|
| Critical | 0 | None. |
| High | 0 | H1 closed; H2 closed in both branches. |
| Medium | 1 | M1 remains open but is deferred to M8-T9 and does not meet the Critical/High blocking rule. |
| Low | 0 | None. |

### Finding status and evidence

- **H1 — CLOSED.** In `getAdminPublishedFormForPublicEvent`, the direct-match
  loop now compares the raw `candidate.eventId` with the requested event and,
  when `input.organizationId != null`, raw `candidate.organizationId` with the
  requested organization before normalization (`src/lib/db/adminForm.ts:104-122`).
  Mismatches are skipped. The regression at
  `src/__tests__/m8-t4-fullstack-form-dal-mutations.test.ts:77-81` seeds a
  published direct candidate for `event-a` owned by `org-b`, requests the same
  event for `org-a`, and proves the foreign candidate is not returned.
- **H2 — CLOSED.** `getAdminFormForEvent` now protects both resolution
  branches with raw stored-field comparisons. Its direct loop skips a
  candidate unless raw `eventId` and raw `organizationId` match the request
  (`src/lib/db/adminForm.ts:44-57`); its pointer fallback returns null unless
  the by-ID form's raw `eventId` and raw `organizationId` both match
  (`src/lib/db/adminForm.ts:59-78`). `getAdminPublishedFormForEvent` delegates
  to this guarded getter before checking publication status
  (`src/lib/db/adminForm.ts:81-94`). The two-org regressions at
  `src/__tests__/m8-t4-fullstack-form-dal-mutations.test.ts:89-99` separately
  exercise the direct and pointer branches and prove that Org B forms are not
  resolved for Org A.
- **M1 — OPEN, DEFERRAL ACCEPTED FOR THIS GATE.** The route's `mode: "all"`
  input is produced by the unbounded linked-form query at
  `src/lib/db/adminForm.ts:170-181`, so a safe Firestore batch/chunk design
  requires a bounded-query or pagination contract beyond this ticket. The
  complete pre-write validation remains intact: every supplied ID is reloaded,
  every raw Form organization/template/detached field is checked, and each
  raw stored `eventId` is resolved with the template organization's scoped
  Event getter before the update loop begins (`src/lib/db/adminForm.ts:239-289`).
  Thus invalid, missing, detached, or cross-tenant input causes zero writes.
  The residual risk is partial operational application if a later sequential
  write fails after an earlier one succeeds; it is not a cross-tenant path.
  Deferral to backlog ticket M8-T9 is therefore acceptable under this loop's
  Critical/High blocking rule.

### Sibling sweep re-confirmation

The form-resolution and by-ID caller sweep found no remaining instance of the
raw-field-masking class. The two pointer-driven `getAdminFormById` calls are
the guarded fallbacks above. Its only other in-module use is the template
application reload, whose raw ownership checks complete before any write.
`getAdminPublishedFormForEvent` inherits the corrected scoped getter. The
organization Form list is constrained by a raw Firestore organization query;
the linked-template list cannot turn normalization into a cross-tenant write
because `applyAdminTemplateToForms` reloads and validates raw fields. The
previously reviewed EventPage fallback remains guarded. No fourth Form
resolution path was found and the fixes introduced no new tenancy hole.

### Re-review commands and results

- `npm run lint` — **PASS**, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected seven
  pre-existing baseline errors: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No
  M8-T4 source or regression produced an error.
- `npm test -- --run` — **PASS**, exit 0: **182 files / 2,017 tests / 0 todo**.
  Existing React test warnings and development-secret fallback warnings were
  emitted; no test failed.
- Read-only `rg`, numbered source reads, and `git diff` sweeps covered the Form
  getters, normalization, by-ID callers, template apply route/query, tests,
  and M8-T9 backlog entry.

Security Agent, 2026-07-19. Scope: the complete uncommitted M8-T4 production
diff and seven promoted test files, reviewed against the Code Review and QA
coverage plan. This was an adversarial reviewer-only pass; no application code
was changed.

## Gate result — FAIL

**FAIL — 0 Critical / 2 High / 1 Medium / 0 Low findings.**

Two still-open cross-tenant Form resolution paths meet the ticket's explicit
High blocking rule. The newly added by-ID public fallback guard is correct, but
the earlier public direct-match branch and the sibling dashboard Form fallback
remain tenant-incorrect. M8-T4 must not pass its security gate in this state.

| Severity | Count | Finding |
|---|---:|---|
| Critical | 0 | None |
| High | 2 | H1 public direct-match Form lookup does not validate raw stored organization ownership; H2 sibling `getAdminFormForEvent` pointer fallback does not validate raw stored event/organization ownership. |
| Medium | 1 | M1 form-template propagation validates the complete list before writing but performs sequential non-transactional writes, so an update failure after the first success can still leave a partial application. |
| Low | 0 | None |

## Findings

### H1 — Public direct-match branch remains tenant-incorrect

**High; gate blocker.** `src/lib/db/adminForm.ts:90-101` queries Forms by
`eventId`, normalizes each candidate with request context, and returns the
first published result without comparing the candidate's raw stored
`organizationId` to `input.organizationId`. `normalizeStoredFormDocument`
uses the context organization when the stored value is absent
(`src/features/form/utils.ts:307-311`), so normalization is not an ownership
check. A pre-existing inconsistent/corrupt Form carrying the requested event
ID but another organization's ID is returned to the public event. The exact
stored-field checks added at `adminForm.ts:116-122` protect only the later
pointer-by-ID fallback.

The promoted regression at
`src/__tests__/m8-t4-fullstack-form-dal-mutations.test.ts:77-81` seeds no
direct match and proves only a pointer target whose stored event and org are
both foreign. It does not prove the direct branch tenant-correct. Fix by
requiring the raw candidate's stored `eventId` and, when supplied, raw stored
`organizationId` to equal the request before normalization/return; add a
two-org direct-match regression.

### H2 — Sibling dashboard Form pointer fallback has the same bug class

**High; gate blocker.** `src/lib/db/adminForm.ts:38-67`
(`getAdminFormForEvent`) first performs an event query, then extracts a Form ID
from `input.formPath`, loads that top-level Form directly, and returns its
normalized representation without comparing the loaded Form's raw stored
`eventId` or `organizationId` to the requested event/org. This is the same
pointer-by-ID-then-normalize masking class as bug #2. It is reachable from
dashboard form reads and mutation routes, including form submit and detach.
The event route now prevents a client from creating a new bad pointer through
generic event editing, but the ticket explicitly requires defense against
pre-existing bad pointers, and historical data can still drive this fallback.

Fix by rejecting the loaded Form unless both raw stored fields exactly match
the request before normalization. `getAdminPublishedFormForEvent` at
`adminForm.ts:69-82` inherits this issue because it delegates to the unsafe
getter.

### M1 — Form-template writes are not operationally atomic

**Medium.** `src/lib/db/adminForm.ts:223-249` correctly reloads every requested
Form, reloads each Form's stored `eventId` through the organization-scoped
Event getter, and rejects the complete list before any write. The route does
not catch the thrown `Error` (`src/app/api/dashboard/forms/templates/[templateId]/apply/route.ts:76-84`),
so the validation failure cannot be converted into success or silently
swallowed.

However, eligible Forms are then updated one at a time at
`adminForm.ts:254-267`. If update N succeeds and update N+1 rejects, earlier
writes remain committed. Thus invalid mixed input is pre-write atomic, but the
stronger claim that no partial-write path remains is not true under ordinary
write failure. Use a Firestore transaction/batch (with the documented write
limit handled explicitly) if all-or-nothing propagation is required.

## Per-fix completeness verdict

### 1. Event update route server ownership — COMPLETE

`src/app/api/dashboard/events/[eventId]/route.ts:63-78` compares every
tenant/pointer field present in `eventFormSchema` against the already
organization-scoped stored Event and returns 403 before `updateAdminEvent`.
The update spreads no other resource ID, organization attribution, or path.
Zod's object parsing also strips unknown body keys, so a client cannot smuggle
an extra ownership field through `parsed.data`.

The guard uses exact stored values, including `undefined` for an absent
`eventPagePath`; this preserves server ownership. The tests prove 403/no write
for changed `organizationPath` and `formPath`. They do not separately vary
`eventPagePath` and `invoicePath`, but the shared four-way condition makes
their production behavior equivalent.

### 2. Public Form pointer hardening — INCOMPLETE

The pointer fallback at `src/lib/db/adminForm.ts:104-134` checks the raw loaded
Form before normalization. Its `eventId` must match unconditionally, and its
raw `organizationId` must match when the request supplies an organization.
Those comparisons are against `linkedForm`, not the context-normalized
`parsed` object, and are correct.

The direct-match branch at `adminForm.ts:90-101` is not tenant-correct because
it lacks the equivalent raw organization check (H1). The sibling sweep also
found the unsafe non-public getter (H2). Therefore fix #2 is incomplete.

### 3. Form-template apply validation — PARTIALLY COMPLETE

The tenancy/integrity validation is correctly full-list-before-write: all
Forms are reloaded by ID, their raw organization, template link and detached
state are checked, and each reloaded Form's own stored `eventId` is resolved by
`getAdminEventForOrganization`. `Promise.all` completes these reads before the
single `some(...)` rejection and before the update loop. Missing Forms,
missing event IDs, foreign/missing Events, wrong template links, and detached
Forms all throw before a write. The caller does not catch the error.

The promoted tests use real two-org fake-store documents, assert rejection,
compare every supplied Form with its before image, and assert a zero write log.
They genuinely prove validation-path tenancy. Operational all-or-nothing
behavior remains incomplete under an update failure (M1).

### 4. Promotion-template apply-to-events atomic validation — COMPLETE

`src/lib/db/adminPromotionTemplate.ts:139-159` loads the full template match
set, computes all missing/foreign requested IDs, and returns before constructing
or committing any batch when the list contains either. Because `filter`
examines the complete requested array before the write loop, ordering does not
matter: a foreign ID in the first position and a foreign ID in the last
position both produce `updated: 0` and no batch writes. The promoted DAL and
route regressions use real Org A/Org B rows and assert both tenants' stored
names remain unchanged; their current mixed arrays place the foreign ID last.
The code proves the first-position case, though a reversed-order regression
would make that boundary explicit.

Customized rows are considered only after ownership completeness passes.
No client organization value enters the route: template and organization
scope come from the authenticated user and organization-scoped template
getter.

## `eventFormSchema` field-by-field tenancy classification

| Field | Classification | Reason |
|---|---|---|
| `name` | safe-client-editable | Event display content only; not used as tenant/resource identity. |
| `description` | safe-client-editable | Event display content only. |
| `capacity` | safe-client-editable | Bounded integer event configuration. |
| `expectedGuests` | safe-client-editable | Non-negative integer planning value. |
| `eventPagePath` | server-owned-and-guarded | Resource pointer; exact comparison with stored Event before write. |
| `formPath` | server-owned-and-guarded | Form resource pointer; exact comparison with stored Event before write. |
| `invoicePath` | server-owned-and-guarded | Server pointer/integrity field; exact comparison before write. |
| `organizationPath` | server-owned-and-guarded | Tenant attribution; exact comparison with the scoped Event before write. |
| `timezone` | safe-client-editable | Event scheduling configuration, not ownership/pointer data. |
| `allowOverlap` | safe-client-editable | Scheduling behavior flag. |
| `status` | safe-client-editable | Permission-gated Event publication state. |
| `pageMode` | safe-client-editable | Selects default/custom/redirect rendering behavior but does not identify another stored resource. |
| `redirectUrl` | safe-client-editable | Organizer-controlled redirect destination required by `pageMode`; it is not a tenant or internal-resource pointer. Existing product policy may separately govern external redirects. |
| `registrationPeriod` | safe-client-editable | Validated registration start/end date-time values. |
| `periods` | safe-client-editable | Validated Event schedule ranges. |

**MISSED fields: none in `eventFormSchema`.** Unknown request fields are not
present in parsed output and therefore are not spread into the update.

## Sibling pointer-getter sweep

The sweep covered all `src/lib/db/*.ts` exports and searched for public/event
getters, path extraction, by-ID loads followed by normalization, and path-like
arguments.

| Severity | Getter | Result |
|---|---|---|
| High | `src/lib/db/adminForm.ts:38-67` — `getAdminFormForEvent` | **Unsafe sibling found:** raw by-ID Form ownership is not checked before normalization/return (H2). |
| High | `src/lib/db/adminForm.ts:69-82` — `getAdminPublishedFormForEvent` | Inherits H2 by delegation; not counted as an additional root finding. |
| None | `src/lib/db/adminEventPage.ts:44-95` — `getAdminEventPageForEvent` | Safe: the by-ID shortcut requires parsed stored `eventId`, `organizationId`, and `pageKey`; the query fallback checks raw organization and parsed page key. |
| None | Other pricing, registration, ticket, fee, tax, report and promotion getters | No sibling client-influenced path-pointer-by-ID-then-normalize fallback found. Their by-ID getters use explicit event/org predicates or are not driven by a stored pointer path. |

Separately, H1 at `src/lib/db/adminForm.ts:90-101` is inside the ticket's named
public getter rather than a sibling and is reported independently.

## Regression quality and surface checks

- The promoted regressions are real executable Vitest tests, and the principal
  mixed-tenant tests seed distinct Org A/Org B documents and assert status,
  return shape, stored before/after state, and/or write logs. The fallback
  regression is meaningful for the branch it reaches, but its single foreign
  pointer does not cover H1 or H2.
- Promotion DAL and route tests prove no mutation of both the owned and foreign
  rows for a mixed list. They currently cover foreign-last, not foreign-first.
- Form-template DAL tests prove no write across mixed detached/foreign input
  and a foreign target Event, but do not simulate a mid-loop write rejection
  (M1).
- `git diff HEAD -- firestore.rules firestore.indexes.json` is empty. No rule
  or index surface changed.
- No new API route file is introduced by the ticket. The sole route production
  change tightens an existing mutation endpoint.
- `git diff HEAD -- package.json package-lock.json` is empty: **0 dependency
  manifest/lock changes and therefore zero ticket audit delta**.
- A scoped secrets-pattern sweep of all M8-T4 production/test files and the
  review/plan documents found no credentials, private keys, bearer tokens,
  service-account material, or hardcoded production secrets.

## Commands run and results

- Numbered reads and `git diff HEAD` of all three changed production files;
  complete reads of the review, QA plan, relevant schemas/utilities, callers,
  and all promoted security regressions — completed.
- `rg` sweeps across `src/lib/db` for `get*ForPublic*`, `get*ForEvent`, by-ID
  loads, path ID extraction, normalization, and path-like fields — H1/H2 found;
  safe EventPage fallback confirmed.
- `git diff HEAD -- firestore.rules firestore.indexes.json package.json
  package-lock.json` — empty.
- Scoped secret-pattern `rg` — no finding.
- `npm run lint` — **PASS**, exit 0, no warnings or errors.
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the expected **7
  pre-existing baseline errors**: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No M8-T4
  file produced an error.
- `npm test -- --run` — **PASS: 182 files / 2,013 tests / 0 todo**, exit 0.
  Existing React ref warnings and development-secret fallback warnings were
  emitted; no test failed.
- `npm audit --json` — registry unreachable: `getaddrinfo ENOTFOUND
  registry.npmjs.org`; no live vulnerability counts were available. The
  manifest/lock zero-delta was independently verified.

## Report-file confirmation

This report is the sole workspace file created or modified by the Security
Agent: `agents/docs/security/m8-t4-coverage-backfill.md`.
