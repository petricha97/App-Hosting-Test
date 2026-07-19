# Security Review — M8-T9 Form-Template Apply Atomicity

Security Agent, 2026-07-19. Scope: the complete M8-T9 working-tree diff in
`adminForm.ts`, the form-template apply route, the fake Admin DB, and the two
changed regression suites. This was a reviewer-only assessment against the
M8-T4 security findings and the requested M8-T9 gate; no application code was
changed.

## Gate result — PASS

**PASS — 0 Critical / 0 High / 0 Medium / 0 Low findings.**

The M8-T4 tenancy validation remains intact and precedes every staged write.
The mutation is capped at 500 Forms and now commits through one Firestore
batch, so a validated application either updates every target Form or none.
No bound bypass, new information leak, or authorization regression was found.

| Severity | Count | Finding |
|---|---:|---|
| Critical | 0 | None |
| High | 0 | None |
| Medium | 0 | None; M8-T4 M1 is closed by the bounded single-batch commit. |
| Low | 0 | None |

## 1. Tenancy-intact verdict

**No finding; M8-T4 protections are unchanged and remain pre-write.** The
focused `git diff -U40` proves the refactor added only the up-front length
guard and replaced the post-validation sequential update loop. It did not
move, weaken, or bypass the validation block.

`applyAdminTemplateToForms` first rejects more than 500 caller-supplied Forms
(`src/lib/db/adminForm.ts:256-262`). It then reloads **every** supplied Form by
ID at lines 264-266 rather than trusting caller-provided Form fields. For each
reloaded Form, it resolves that Form's raw stored `eventId` through
`getAdminEventForOrganization(eventId, template.organizationId)` at lines
268-277. The complete-list predicate then requires all of the following at
lines 279-290:

- the Form exists;
- `form.organizationId === template.organizationId`;
- `form.templateLink.templateId === template.id`;
- the template link is not detached; and
- the target Event exists in the template organization.

Only after both read phases and the full-list predicate succeed is a batch
created (`adminForm.ts:292-293`); writes are staged later at lines 295-307 and
committed at line 311. Consequently, a missing, detached, wrong-template,
foreign-organization, or foreign/missing-event Form rejects the entire input
with **zero writes**. The existing two-organization M8-T4 regression remains
in the passing full suite, and the production ordering independently proves
that a foreign Form cannot enter the batch.

## 2. Atomicity as a security property

**No finding; M8-T4 M1 is closed.** All eligible Form updates are staged in
one `WriteBatch` and exactly one `batch.commit()` is awaited
(`src/lib/db/adminForm.ts:292-313`). There is no chunking and no per-Form
commit. Firestore batch commit is atomic, so an ordinary write failure cannot
leave only an earlier subset on the new template version.

The test-only fake now validates the complete staged write set before mutating
its store and supports an opt-in failure at a chosen batch operation
(`src/__tests__/helpers/fake-admin-db.ts:539-562,585-590`). The regression
injects failure at operation 1, observes rejection, unchanged before-images
for both Forms, and zero recorded writes
(`src/__tests__/m8-t4-fullstack-form-dal-mutations.test.ts:49-65`). The normal
path also asserts two committed update writes at lines 43-46.

## 3. Bound and bypass assessment

**No finding; the amplification bound is genuine in both modes.** The route
passes `MAX_TEMPLATE_APPLY_FORMS + 1` (501) into the linked-Form reader
(`src/app/api/dashboard/forms/templates/[templateId]/apply/route.ts:66-72`).
The DAL applies that value as Firestore `query.limit(input.limit)` **before**
`.get()` (`src/lib/db/adminForm.ts:181-194`); this is not fetch-all-then-slice.
Thus no request through this route transfers more than 501 linked-query
documents.

For `mode: "all"`, a 501st returned linked Form produces a fixed 422 before
target selection, per-Form reloads, Event lookups, batch creation, or writes
(`route.ts:74-90`). The regression seeds 501 Forms and verifies 422 plus
unchanged fields for every Form
(`src/__tests__/m8-t4-backend-form-template-routes.test.ts:97-119`). The only
work before rejection is authentication/template lookup, request validation,
and the necessary bounded 501-row detection query.

For `mode: "selected"`, the route filters only that same bounded result and
rejects if the resulting target set exceeds 500 (`route.ts:92-108`). More
importantly, the DAL independently rejects `input.forms.length > 500` before
any Form reload or Event lookup (`adminForm.ts:256-266`), regardless of route
mode or caller. Therefore `formIds` mode cannot bypass the mutation cap.

## 4. Error information leakage and clean 422

**No finding.** Both route limit branches return only a stable public code, a
generic maximum-count message, and the public numeric cap
(`route.ts:76-108`). They disclose no Form IDs, organization IDs, Event IDs,
document contents, collection paths, exception text, or stack trace.
`TemplateApplyLimitError` likewise contains only the stable code and cap
(`src/lib/db/adminForm.ts:18-27`), with no PII or internal state.

The API boundary checks both possible route-selected target shapes before it
calls the DAL, returning 422 itself; the DAL limit exception is therefore not
reachable as an unhandled 500 from this route. The independent DAL guard
remains defense in depth for non-route callers. The route regression verifies
the exact clean 422 response body.

## 5. Authorization and organization scope

**No finding; unchanged.** The M8-T9 route diff is additive after the existing
scope checks and changes no authentication or authorization line. The route
still requires a session, successfully decoded user, server-loaded user with
an organization, and `write:form` permission
(`src/app/api/dashboard/forms/templates/[templateId]/apply/route.ts:25-48`).
It then loads the template with that server-derived organization at lines
50-57 and supplies the same organization to the linked-Form query at lines
66-72.

The ticket text refers to `write:events`; direct source read shows that this
route's actual pre-existing permission is `write:form`. That check is
unchanged by M8-T9, and no client-provided organization scope is accepted.

## 6. Test-only and ancillary security surfaces

**No finding.** The fake-DB batch/failure control exists only under
`src/__tests__/helpers` and has no production import or runtime impact. The
complete changed-file inventory contains only two production files and three
test files. `git diff HEAD -- firestore.rules firestore.indexes.json` is
empty, so this ticket adds no Firestore rules or index surface.

`git diff HEAD -- package.json package-lock.json` is empty, establishing zero
dependency-graph and ticket-caused audit delta. A live `npm audit --json`
could not reach `registry.npmjs.org` because DNS returned `ENOTFOUND`, so no
fresh advisory count is claimed. A case-insensitive secret scan of all five
ticket files found no API key, password, private key, client secret, bearer
token, service-account material, or new environment/configuration secret.

## Findings

No severity-classified findings. Relevant security evidence is at:

- `src/lib/db/adminForm.ts:256-290` — cap, full-list reload, organization,
  template-link, detached, and organization-owned Event validation;
- `src/lib/db/adminForm.ts:292-313` — one staged batch and one atomic commit;
- `src/lib/db/adminForm.ts:181-194` — query-level limit before `.get()`;
- `src/app/api/dashboard/forms/templates/[templateId]/apply/route.ts:25-57` —
  unchanged authentication, `write:form`, and organization-scoped template;
- `src/app/api/dashboard/forms/templates/[templateId]/apply/route.ts:66-113`
  — 501-read, both route cap checks, clean 422, then DAL call; and
- `src/__tests__/m8-t4-fullstack-form-dal-mutations.test.ts:49-65` — injected
  batch failure with no partial state and no recorded writes.

## Commands run and results

- Read-only `git status`, complete changed-file inventory, scoped and
  context-expanded `git diff HEAD`, numbered source reads, and targeted `rg`
  traces — completed. No Code Review report was present at
  `agents/docs/reviews/m8-template-apply-atomicity.md`.
- `npm run lint` — **PASS**, exit 0, no ESLint warnings or errors (only the
  Next.js deprecation/workspace-root notices).
- `npx tsc --noEmit --pretty false` — exit 1 with exactly the documented **7
  pre-existing test errors**: `attendees-roster.test.ts:106,160,221`,
  `event-org-scoping.test.ts:152-154`, and `register-route.test.ts:62`. No
  M8-T9 file produced an error.
- `npm test -- --run` — **PASS**, exit 0: **186 test files / 2,054 tests**.
  Existing React and development-secret warnings were emitted; no test failed.
- `npm audit --json` — registry unavailable due DNS `ENOTFOUND`; manifests
  and lockfile were independently verified unchanged.
- `git diff HEAD -- firestore.rules firestore.indexes.json package.json
  package-lock.json` — empty.
- Scoped secrets scan over all five ticket files — no match.

## Report-file confirmation

This report was written as the sole workspace modification made by the
Security Agent at `agents/docs/security/m8-template-apply-atomicity.md`.
