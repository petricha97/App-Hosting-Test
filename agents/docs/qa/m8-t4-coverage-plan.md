# M8-T4 authoritative coverage gap analysis and implementation plan

Date: 2026-07-19  
Owner: QA  
Scope of this dispatch: analysis and planning only; no tests or configuration changes

## Executive summary

The repository currently has 175 test files / 1,950 passing tests (the supplied baseline). This audit found 83 API route files, of which 18 have no test reference to the route module or route-specific path. Sixteen of those 18 are authenticated mutations and are P0. The DAL contains 212 exported functions across 50 modules; 44 exported functions have no symbol reference in `src/__tests__`, including 15 mutations (P1), 15 permission/tenancy-relevant readers (P2), and 14 lower-risk helpers or legacy client-DAL functions (P3). None of the unreferenced DAL functions contains `runTransaction`; all transaction-bearing DAL functions have at least a test symbol reference.

The older feature surfaces remain visibly thin: promotions have 11/14 runtime exports unreferenced, forms 31/43, and event-pages/page-builder 18/29. These runtime-export counts deliberately exclude TypeScript-only interfaces and type aliases.

## Methodology

This was a static reference sweep of the working tree, not an inference from ticket history.

1. API inventory: ran `find src/app/api -name route.ts | sort` and extracted exported HTTP handlers (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) from every file. For each route, searched all `.ts`/`.tsx` files under `src/__tests__` for its exact `@/app/api/.../route` module stem and its route-specific URL/path. A route is listed below only when neither form was found. A mere URL reference counts as a reference under the ticket's “ANY test file references it” rule; it does not prove direct handler coverage.
2. DAL inventory: enumerated `src/lib/db/*.ts`, parsed exported function declarations and exported function-valued variables, and searched `src/__tests__` for each symbol as a word. This yielded 212 exported functions in 50 modules. Source was separately searched for `runTransaction`/transaction calls to identify transactional risk.
3. Feature inventory: located forms at `src/features/form`, promotions at `src/features/event-promotions` plus `src/features/promotion-templates`, and page-builder at `src/features/event-pages` (confirmed by Puck imports and the dashboard `page-builder` route). Parsed runtime exports and searched tests for exact exported symbols. Type-only exports were excluded from the headline feature counts; unreferenced schemas/components/helpers are listed below.
4. Coverage tooling: inspected `vitest.config.mts` and `package.json`. There is no Vitest coverage configuration and no `@vitest/coverage-v8`, `@vitest/coverage-istanbul`, c8, or Istanbul dependency. Because `vitest --coverage` would require adding a provider, coverage was not run and no dependency was added. Consequently there are no honest statement/branch/function/line percentages by directory in this dispatch.
5. Risk classification: P0 = untested authenticated/tenant-scoped mutation route where a scoping or permission regression can write across tenants or elevate capability; P1 = other untested mutations or transaction/multi-document propagation logic; P2 = permission/tenancy-relevant readers; P3 = other unreferenced runtime behavior.

This method detects references, not assertion quality or runtime execution. A symbol referenced only through a mock still counts as referenced, so the gap list is conservative.

## API routes without test references

There are 83 route files total and 18 without any route-module or route-specific-path reference (16 mutation/auth-critical, 2 read/auth-critical).

| Route | Methods | Mutation/read | Auth-critical | Priority |
|---|---|---|---|---|
| `/api/dashboard/events/[eventId]/form/detach` | POST | Mutation | Yes: `write:form`, org/event scope | P0 |
| `/api/dashboard/events/[eventId]/form` | POST | Mutation | Yes: `write:form`, org/event scope | P0 |
| `/api/dashboard/events/[eventId]/form/submit` | POST | Mutation | Yes: `write:form`, org/event/form scope | P0 |
| `/api/dashboard/events/[eventId]/page/assets` | GET, POST | Read + storage mutation | Yes: `write:events`, org/event/storage-prefix scope | P0 (POST); P2 (GET) |
| `/api/dashboard/events/[eventId]/promotions/[promotionId]` | POST, DELETE | Mutation | Yes: `write:events`, org/event/promotion scope | P0 |
| `/api/dashboard/events/[eventId]/promotions` | POST | Mutation | Yes: `write:events`, org/event/template scope | P0 |
| `/api/dashboard/events/[eventId]/responses` | GET | Read | Yes: org/event response data | P2 |
| `/api/dashboard/events/[eventId]` | POST | Mutation | Yes: authenticated org-scoped event creation/update path | P0 |
| `/api/dashboard/forms/templates/[templateId]/apply` | POST | Mutation | Yes: `write:form`, org/template/event scope | P0 |
| `/api/dashboard/forms/templates/[templateId]` | POST | Mutation | Yes: `write:form`, org/template scope | P0 |
| `/api/dashboard/forms/templates` | POST | Mutation | Yes: `write:form`, org scope | P0 |
| `/api/dashboard/promotions/templates/[templateId]/apply-to-events` | POST | Multi-event mutation | Yes: `write:events`, org/template/event scope | P0 |
| `/api/dashboard/promotions/templates/[templateId]/apply` | POST | Mutation | Yes: `write:events`, org/template scope | P0 |
| `/api/dashboard/promotions/templates/[templateId]/eligible-events` | GET | Read | Yes: org-scoped event/template data | P2 |
| `/api/dashboard/promotions/templates/[templateId]` | POST, DELETE | Mutation | Yes: `write:events`, org/template scope | P0 |
| `/api/dashboard/promotions/templates` | POST | Mutation | Yes: `write:events`, org scope | P0 |
| `/api/dashboard/settings/organization/logo` | POST | Storage/profile mutation | Yes: authenticated org ownership | P0 |
| `/api/dashboard/settings/profile/avatar` | POST | Storage/profile mutation | Yes: authenticated user identity | P0 |

The auth session route is not in this table because `/api/auth/session` occurs in `accept-invitation-view.test.tsx`. That test exercises a caller's fetch behavior, not the route handler; this is recorded as a limitation/deferred assertion-quality audit rather than contradicting the required reference rule.

## DAL functions without test references

There are 212 exported functions across 50 `src/lib/db/*.ts` modules; 44 have no exact symbol reference in tests.

### P1 — mutations and propagation logic (15)

| Module | Unreferenced function(s) | Why P1 |
|---|---|---|
| `adminEventPromotion.ts` | `deleteAdminEventPromotion` | Event-scoped destructive write |
| `adminForm.ts` | `detachAdminFormFromTemplate`, `applyAdminTemplateToForms` | Link-state mutation; latter propagates to multiple forms |
| `adminFormData.ts` | `markAdminFormDataAttendeeCreated` | Submission lifecycle mutation |
| `adminPromotionTemplate.ts` | `applyTemplateToInheritingEvents`, `applyTemplateToSpecificEvents` | Multi-event propagation |
| `organization.ts` | `createOrganization` | Client DAL creation mutation |
| `registrationType.ts` | `createRegistrationType`, `updateRegistrationType`, `deleteRegistrationType` | Client DAL CRUD mutations |
| `ticketType.ts` | `createTicketType`, `updateTicketType`, `deleteTicketType` | Client DAL CRUD mutations |
| `user.ts` | `createUser`, `updateUser` | Client DAL identity/profile mutations |

### P2 — permission/tenancy-relevant readers (15)

| Module | Unreferenced function(s) |
|---|---|
| `adminEvent.ts` | `getAdminPublishedEvents`, `listAdminPublishedEventsPage` |
| `adminEventPromotion.ts` | `getAdminAllEventPromotionsForOrg` |
| `adminForm.ts` | `getAdminPublishedFormForEvent`, `getAdminFormsForOrganization`, `getAdminLinkedFormsForTemplate` |
| `adminFormData.ts` | `getAdminFormDataForOrganization`, `listAdminFormDataForEventByStatuses` |
| `adminFormTemplate.ts` | `getAdminFormTemplatesForOrganization`, `getAdminActiveFormTemplatesForOrganization`, `getAdminFormTemplateForOrganization` |
| `adminPromotionTemplate.ts` | `getAdminPromotionTemplateForOrganization` |
| `adminUserOrganization.ts` | `getAdminUserMembership`, `isAdminUserOrganizationMember` |
| `adminTax.ts` | `getAdminTaxesForEvent` |

### P3 — other helpers, public/client readers, and subscriptions (14)

| Module | Unreferenced function(s) |
|---|---|
| `formDataStatus.ts` | `formDataStatusRank` |
| `organization.ts` | `getOrganization`, `subscribeToOrganization` |
| `registrationCode.ts` | `normalizeRegistrationCode`, `isValidRegistrationCode` |
| `registrationType.ts` | `getRegistrationTypesForEvent`, `getRegistrationTypeForEvent`, `isRegistrationTypeCodeTaken` |
| `ticketType.ts` | `getTicketTypesForEvent`, `getTicketTypeForEvent`, `isTicketTypeCodeTaken`, `getTicketTypesReferencingRegistrationType` |
| `user.ts` | `getUser`, `subscribeToUser` |

Reconciliation: 15 P1 + 15 P2 + 14 P3 = 44.

### Transaction logic

The source contains transaction calls in `adminAttendee.ts`, `adminCheckinConfig.ts`, `adminEmailDefinition.ts`, `adminEmailMessage.ts`, `adminEmailSettings.ts`, `adminFormData.ts`, `adminInvitation.ts`, `adminOrder.ts`, `adminReportSchedule.ts`, and `adminUserOrganization.ts`. Every exported function containing those calls has at least one symbol reference in tests. This sweep therefore found **zero wholly unreferenced transaction functions**. It does not prove conflict/retry behavior; M8-T8 already separately tracks the known last-Owner TOCTOU simulation gap.

## Promotions, forms, and page-builder sweep

| Area | Located at | Source files | Runtime exports | Unreferenced | Referenced |
|---|---|---:|---:|---:|---:|
| Promotions | `src/features/event-promotions`, `src/features/promotion-templates` | 12 | 14 | 11 | 3 |
| Forms | `src/features/form` | 8 | 43 | 31 | 12 |
| Page-builder | `src/features/event-pages` (Puck) | 11 | 29 | 18 | 11 |

### Promotions — unreferenced runtime exports (P3, deferred)

- Logic/schema: `formatConditionRule`, `evaluateConditions`, `conditionRuleSchema`, `promotionTemplateSchema`, `promotionTemplateFields`, `CONDITION_FIELD_OPTIONS`.
- Components: `AttachPromotionDialog`, `ApplyToEventsDialog`, `PromotionTemplateFormDialog`, `PromotionTemplatesBrowser`, `PromotionTemplateCard`.

### Forms — unreferenced runtime exports (P3, deferred)

- Schemas/constants: `formFieldTypeSchema`, `formFieldOriginSchema`, `COMMERCE_FIELD_TYPES`, `formStatusSchema`, `formTemplateStatusSchema`, `formTemplateLinkSchema`, `storedFormDocumentSchema`, `storedFormTemplateDocumentSchema`, `formTemplateDocumentSchema`, `formSubmissionDataSchema`, `formDataDocumentSchema`.
- Logic: `reorderFormFields`, `sanitizeFormFieldsForFirestore`, `ensureMandatoryFields`, `buildInitialFormDraft`, `buildInitialTemplateDraft`, `buildFormDraftFromTemplate`, `extractFormIdFromPath`, `normalizeStoredFormDocument`, `normalizeStoredFormTemplateDocument`, `serializeFormTemplate`, `isTemplateManagedField`, `cloneTemplateFieldsForEvent`, `createMandatoryFormFields`, `buildDefaultFormTitle`, `buildDefaultSubmissionValues`, `renderFieldInput`.
- Components: `TemplateLinkedFormsManager`, `FormBuilderWorkspace`, `FormTemplateBuilderWorkspace`, `EventFormTemplateChooser`.

### Page-builder — unreferenced runtime exports (P3, deferred)

- Schemas/constants: `PRICING_TABLE_DEFAULT_EMPTY_MESSAGE`, `COUNTDOWN_DEFAULT_COMPLETED_MESSAGE`, `eventPageContentSchema`, `eventPageStatusSchema`, `eventPageDocumentSchema`, `saveEventPageDraftSchema`, `starterTemplates`, `blankCustomData`.
- Logic: `ensurePuckDataIds`, `createPublicRegistrationRenderer`, `createDashboardRegistrationRenderer`, `buildEventPageAssetsPrefix`, `sanitizeStorageFileName`, `buildEventPageStoragePrefix`, `buildEventPagePath`, `extractEventPageIdFromPath`, `serializeEventPage`.
- Component: `EventPagesPrototype`.

## Required proof for every P0/P1 item

### P0 route proofs

- Event form detach POST: prove missing permission and foreign-org event/form cannot detach, while an authorized same-org request detaches only the targeted form.
- Event form save POST: prove foreign-org event IDs and missing `write:form` cannot create/update a form or event pointer; authorized create and update preserve tenant IDs.
- Event form submit POST: prove a caller cannot submit against another org's event/form and invalid dynamic-field data does not write.
- Page assets POST: prove the storage object prefix is derived from the authenticated org/event, foreign events are rejected, and invalid/empty files do not write.
- Event promotion item POST/DELETE: prove a foreign-org promotion cannot be updated/deleted even when the event/promotion IDs are supplied directly.
- Event promotion collection POST: prove both event and source template belong to the active org before the snapshot is created, and duplicate attach is rejected.
- Dashboard event POST: prove event writes are permission-gated and cannot target or attribute data to another organization.
- Form-template apply POST: prove template and every target form/event are in the active org before propagation.
- Form-template item POST: prove only an authorized same-org template can be updated and malformed fields cause no write.
- Form-template collection POST: prove creation stamps the server-derived org and rejects users without `write:form`.
- Promotion-template apply-to-events POST: prove every target event and the template are same-org before any event promotion is changed (including mixed valid/foreign input with no partial cross-tenant write).
- Promotion-template apply POST: prove propagation is restricted to the authenticated org and the requested inheritance semantics.
- Promotion-template item POST/DELETE: prove foreign-org IDs are indistinguishable from missing resources and cause no update/delete.
- Promotion-template collection POST: prove creation uses server-derived org scope and rejects missing permission/invalid condition payloads.
- Organization logo POST: prove the upload can modify only the authenticated organization and invalid files do not reach storage/DAL writes.
- Profile avatar POST: prove the upload updates only the authenticated user's record/storage prefix and cannot nominate another identity.

### P1 DAL proofs

- `deleteAdminEventPromotion`: prove the delete path is event-scoped and deletes exactly the requested document.
- `detachAdminFormFromTemplate`: prove only link metadata changes and unrelated form content is preserved.
- `applyAdminTemplateToForms`: prove all and only linked, non-detached target forms receive the intended version/fields, with tenant boundaries preserved.
- `markAdminFormDataAttendeeCreated`: prove the lifecycle flag/attendee ID update is idempotent and does not overwrite unrelated submission data.
- `applyTemplateToInheritingEvents`: prove only inheriting promotions in the template's organization are updated and detached/customized event promotions remain untouched.
- `applyTemplateToSpecificEvents`: prove only the explicit same-org event set is updated and missing/foreign targets cannot be written.
- `createOrganization`: prove the generated document contains only the validated payload and returns the created ID/error correctly.
- `createRegistrationType`: prove it writes under the intended event and persists normalized required fields.
- `updateRegistrationType`: prove it updates only the requested registration type and preserves unrelated data.
- `deleteRegistrationType`: prove it deletes only the requested registration type and surfaces failure.
- `createTicketType`: prove it writes under the intended event and persists normalized required fields.
- `updateTicketType`: prove it updates only the requested ticket type and preserves unrelated data.
- `deleteTicketType`: prove it deletes only the requested ticket type and surfaces failure.
- `createUser`: prove it creates only the requested user document with the validated identity payload.
- `updateUser`: prove it updates only the requested user and cannot silently redirect to another identity.

## Two disjoint implementation dispatches

The dispatches are disjoint by production source file. Implementers may create appropriately grouped files under `src/__tests__`; they must not edit one another's listed source scope.

### Backend dispatch — promotion/template propagation and legacy DAL mutations

Goal: cover the promotion and reusable-template route boundary plus the lower-level mutations best exercised with the fake Admin DB/client Firestore doubles.

Explicit production file scope:

- `src/app/api/dashboard/events/[eventId]/promotions/route.ts`
- `src/app/api/dashboard/events/[eventId]/promotions/[promotionId]/route.ts`
- `src/app/api/dashboard/promotions/templates/route.ts`
- `src/app/api/dashboard/promotions/templates/[templateId]/route.ts`
- `src/app/api/dashboard/promotions/templates/[templateId]/apply/route.ts`
- `src/app/api/dashboard/promotions/templates/[templateId]/apply-to-events/route.ts`
- `src/app/api/dashboard/forms/templates/route.ts`
- `src/app/api/dashboard/forms/templates/[templateId]/route.ts`
- `src/app/api/dashboard/forms/templates/[templateId]/apply/route.ts`
- `src/lib/db/adminEventPromotion.ts`
- `src/lib/db/adminPromotionTemplate.ts`
- `src/lib/db/organization.ts`
- `src/lib/db/registrationType.ts`
- `src/lib/db/ticketType.ts`
- `src/lib/db/user.ts`

Acceptance boundary: all P0 route proofs and P1 DAL proofs associated with these files; prioritize auth/tenant negative cases, then success cases. The client-DAL modules may be confirmed dead before testing, but removal is outside M8-T4 and does not close the gap without an approved scope change.

### Full-Stack dispatch — event form, assets/settings, event route, and form-data DAL

Goal: cover route orchestration that crosses auth, validation, storage, UI-shaped form payloads, and event/form DALs.

Explicit production file scope:

- `src/app/api/dashboard/events/[eventId]/form/route.ts`
- `src/app/api/dashboard/events/[eventId]/form/detach/route.ts`
- `src/app/api/dashboard/events/[eventId]/form/submit/route.ts`
- `src/app/api/dashboard/events/[eventId]/page/assets/route.ts`
- `src/app/api/dashboard/events/[eventId]/route.ts`
- `src/app/api/dashboard/settings/organization/logo/route.ts`
- `src/app/api/dashboard/settings/profile/avatar/route.ts`
- `src/lib/db/adminForm.ts`
- `src/lib/db/adminFormData.ts`

Acceptance boundary: all P0 route proofs and P1 DAL proofs associated with these files. Mock storage at its boundary, assert no call on rejected auth/validation, and retain same-org success coverage.

## Deferred, tracked (P2/P3)

- P2 API readers: dashboard event responses, page asset listing, and promotion-template eligible-events. Add same-org success plus foreign-org/no-membership denial tests after P0/P1.
- P2 DAL readers: the org/event-scoped readers listed above, with explicit mixed-tenant fixtures and pagination/status-filter cases.
- P3 feature runtime exports: all promotions/forms/page-builder symbols listed in the feature sweep. Start with pure transforms and schemas, then component interaction tests; do not inflate coverage with render-only assertions.
- P3 legacy/client DAL: reader/subscription/helper functions listed above. First establish whether these modules are reachable in production; if dead, track deletion separately instead of writing low-value tests solely for a percentage.
- Assertion-quality audit: route modules that only appear as mocks or whose URL is referenced by a caller test (notably `/api/auth/session`) should later be checked for direct handler assertions.
- M8-T8 remains the owner of transaction conflict/retry simulation for the last-Owner guardrail; it is not duplicated here.

## Coverage-floor recommendation

The repository-wide target should remain **80% statements, lines, functions, and branches**, but it is not responsible to enforce that globally during this backfill without first installing a provider and measuring a baseline. A hard 80% global gate could either fail unpredictably or incentivize superficial tests in large older UI files.

Recommended staging:

1. **Now, in M8-T4:** close every P0 and P1 item in the two dispatches; require 100% of the identified P0/P1 source files to have meaningful direct tests, including the named negative auth/tenant assertions. After an approved coverage-provider addition in the implementation/config phase, record the baseline but do not lower quality to chase a number.
2. **Initial enforceable numeric gate:** once measured, enforce no regression from the measured global baseline and require at least **80% statements/lines/functions and 75% branches on newly added or materially changed files**. This is achievable and aligns new work with the global rule while old debt is burned down.
3. **Later repo-wide gate:** raise global thresholds in small, explicit steps (suggested 5 percentage points per backfill ticket) until all four global metrics reach 80%. Do not claim the final date or number of stages until the first instrumented baseline exists.

No configuration change is authorized or made by this plan.

## Limitations

- No instrumented coverage summary exists because the required provider is not installed. Directory percentages would be fabricated, so none are reported.
- Reference presence is weaker than executed/meaningful coverage. Imports used only for mocks, caller-only URL assertions, and weak assertions can produce false reassurance; this sweep intentionally reports “referenced,” not “covered.”
- Symbol-name matching can produce a false positive when an unrelated test-local identifier has the same name. Exact route-module matching is stronger than the DAL/feature symbol sweep.
- Dynamic routes cannot always be recognized from concrete URL strings; exact module imports were the primary route signal. Manual review was applied to the final no-reference set.
- The feature export counts cover exported runtime surfaces, not private branches inside components, Next.js page/layout files, or type-only contracts.
- Transaction calls were identified statically. A reference does not prove conflict retries, atomicity, rollback, or emulator fidelity; M8-T8 explicitly covers the known concurrency hole.
- The supplied 1,950-test passing baseline was not rerun because this analysis does not change executable code and the requested coverage run was unavailable without a new dependency.
