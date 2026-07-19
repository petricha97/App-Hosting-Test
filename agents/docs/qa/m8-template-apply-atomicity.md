# QA Report — M8-T9 Form-template propagation operational atomicity

QA Agent, 2026-07-19. Scope: M8-T9 acceptance criteria, the approved-after-fixes Code Review, the passing Security review, the M8-T4 M1 deferral being closed, the uncommitted implementation, and its regression tests. This pass added independent route-to-real-DAL coverage using the shared fake Admin Firestore surface. No production or pre-existing test file was changed by QA.

## Verdict

| Ticket | Verdict |
|---|---|
| M8-T9 — Form-template propagation operational atomicity | **SIGNED OFF** |

All requested acceptance behaviors pass. The mutation is bounded to one batch of at most 500 Forms, the fake batch failure regression proves no partial application, selected IDs are resolved directly without the former discovery-scan omission, invalid selected IDs receive one generic clean 422 response, tenancy remains pre-write atomic, and both happy modes report the actual committed IDs.

## Defects

**None found at any severity.** No `it.todo` defect pin was necessary.

## Tests added

`src/__tests__/m8-t9-qa-template-apply-atomicity.test.ts` — **1 file / 7 tests**:

1. `ATOMICITY: a failure in a real multi-form fake batch commits no form`
2. `BOUND: mode all over 500 and selected formIds over 500 return 422 with no writes`
3. `NO SILENT SKIP: selected form beyond the former 501-row scan is actually updated`
4. `EXISTENCE ORACLE: detached, unlinked, missing, and cross-org IDs share one generic 422 and write nothing`
5. `TENANCY: a cross-org form mixed into an otherwise eligible apply set causes zero writes`
6. `HAPPY ALL: applies to every eligible linked form and reports exactly the committed IDs`
7. `HAPPY SELECTED: updates exactly the requested eligible forms and return IDs match writes`

The suite imports the real apply route and real `adminForm` DAL. Only authentication, user lookup, template lookup, and the Admin Firestore module boundary are supplied as test infrastructure. It does not mock `applyAdminTemplateToForms`.

## AC traceability

| Acceptance area | Result and evidence |
|---|---|
| Atomicity | **PASS.** `ATOMICITY: a failure in a real multi-form fake batch commits no form` seeds three eligible Forms and owned Events, injects failure at staged batch operation 1, calls the real `applyAdminTemplateToForms`, asserts rejection, compares cloned before-images for all three Forms, and asserts an empty write log. This drives the real batch construction/commit path through the fake DB's opt-in batch-failure injection. |
| Bound: all | **PASS.** `BOUND: mode all over 500 and selected formIds over 500 return 422 with no writes` seeds 501 genuinely linked, normalizable Forms and asserts `mode: "all"` returns the stable limit 422 and performs zero writes. The production linked query receives limit 501; the fake fixture mirrors its nested query field because the shared fake indexes query fields as flat keys. |
| Bound: selected | **PASS.** The same test submits 501 selected IDs and asserts the stable limit 422 and zero writes. The existing route regression also pins the exact response shape, and the DAL retains its independent `>500` typed-error backstop. |
| No silent skip | **PASS.** `NO SILENT SKIP: selected form beyond the former 501-row scan is actually updated` seeds **502** linked Forms (`scan-0` through `scan-501`), selects only `scan-501`, and asserts 200, `{ updatedCount: 1, updatedIds: ["scan-501"] }`, exactly one recorded write to that Form, its new template version/field, and unchanged neighboring `scan-500`. This is a real >501 regression, not a synthetic out-of-range mock. |
| Error handling / existence oracle | **PASS.** `EXISTENCE ORACLE: detached, unlinked, missing, and cross-org IDs share one generic 422 and write nothing` sends all four cases separately through the real route/DAL, asserts 422 for each, asserts the serialized bodies are identical, pins the generic public code/message, verifies stored before-images, verifies the missing ID remains absent, and asserts zero writes. No existence distinction or 500/200 path remains. |
| Tenancy | **PASS.** `TENANCY: a cross-org form mixed into an otherwise eligible apply set causes zero writes` submits an owned eligible Form together with a foreign Form. It receives 422, both before-images remain exact, and the batch write log is empty. This confirms the M8-T4 guard still precedes batch staging/commit. |
| Happy path: all | **PASS.** `HAPPY ALL: applies to every eligible linked form and reports exactly the committed IDs` runs the real bounded linked query, applies both eligible Forms, asserts `{ updatedCount: 2, updatedIds: ["all-one", "all-two"] }`, and matches those IDs to the two actual write paths. |
| Happy path: selected | **PASS.** `HAPPY SELECTED: updates exactly the requested eligible forms and return IDs match writes` requests two of three eligible Forms in deliberate order, asserts the response IDs and write paths match that order exactly, and proves the unrequested Form retains its old fields/version. |

Existing M8-T9 implementation regressions were also retained and passed: the original fake-batch all-or-none test, route cap tests, 502-row selected-mode regression, typed-limit mapping, generic selected-mode 422 cases, all-mode happy path, and M8-T4 cross-organization validation tests.

## Verified versus not verifiable

Verified here:

- Real route to real `adminForm` DAL behavior against the repository's fake Admin Firestore surface.
- Single fake `WriteBatch` failure produces no store mutation and no recorded writes.
- Both 500-Form request bounds and the bounded 501-row overflow probe.
- Direct selected-ID resolution beyond a seeded 501-row discovery range.
- Clean generic 422 equivalence for detached, unlinked, nonexistent, and cross-organization IDs.
- Mixed-set tenancy failure before writes.
- Happy-path mutations, response shape, counts, ID ordering, and response/write correspondence.
- Lint, expected TypeScript baseline, and the complete automated regression suite.

Not verifiable in this environment:

- No live Firestore emulator or production Firestore was available. Operational atomicity was executed against the fake double's staged all-or-none batch model; real Firestore `WriteBatch.commit()` atomic semantics are assumed to match the SDK/service contract already assessed by Code Review and Security.
- Live Firestore nested-field query execution, indexes, network failures, and service-enforced write limits were not exercised. The shared fake's query evaluator uses flat field keys, so the QA fixture mirrors `templateLink.templateId` as an indexing key while preserving the real nested document value consumed by production normalization and validation.
- No live authentication/session or deployed HTTP boundary was exercised; route authorization dependencies were supplied at their module boundaries, while organization and Form eligibility checks ran in the real DAL.

## Command results

| Check | Result |
|---|---|
| Focused QA suite | PASS — **1 file / 7 tests**, 0 failed, 0 todo |
| `npm run lint` | PASS — no ESLint warnings or errors; only Next.js deprecation/workspace-root notices |
| `npx tsc --noEmit --pretty false` | Expected non-zero — exactly **7 baseline diagnostics**: `attendees-roster.test.ts` (3), `event-org-scoping.test.ts` (3), and `register-route.test.ts` (1); **0 M8-T9 QA diagnostics** |
| `npm test -- --run` | PASS — **187 files / 2,068 tests**, 0 failed, 0 todo |
| Delta from supplied baseline 186 / 2,061 | **+1 file / +7 tests**, exactly the new QA suite; zero non-M8-T9 failures |

Pre-existing React ref/`act` and development-warning output remained non-failing.

## Final sign-off

**SIGNED OFF.** M8-T9's core all-or-none behavior, operational bound, selected-mode no-silent-skip fix, typed generic 422 handling, tenancy regression guard, response correctness, and both happy modes are executable and green. No genuine gap or severity-classified defect was found.

## Report-file confirmation

This report is `agents/docs/qa/m8-template-apply-atomicity.md`. QA modified only this new report and the permitted new `src/__tests__/m8-t9-qa-template-apply-atomicity.test.ts` file.
