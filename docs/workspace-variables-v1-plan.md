# Variables v1

## Summary
Add a two-layer variables feature:

- organization-scoped variables managed from the main dashboard
- event-scoped variables managed from inside each event

The goal is to let one organization share common text across multiple events while still allowing an individual event to define its own local variables where needed.

V1 should ship as isolated management and verification pages first:

- `/dashboard/variables` for organization-level variables
- `/dashboard/events/[eventId]/variables` for event-level variables

V1 should also expose built-in read-only defaults derived from existing organization and event data, such as:

- `{{ORGANIZATION_NAME}}`
- `{{EVENT_NAME}}`

The event-level page should show both scopes together so the user can clearly see:

- what is shared across the organization
- what only exists for the current event
- which value wins when the same key exists at both scopes

## Naming
- Use `Variables` as the umbrella product name.
- Use `Organization Variables` for values shared across the workspace.
- Use `Event Variables` for values local to a single event.
- Avoid `Template Variables` in code naming because the product already has:
  - form templates
  - promotion templates

## Product Direction
- The user should be able to create a variable key and assign a text value quickly.
- The feature should feel like a shared content dictionary, not a technical settings panel.
- Variables should be easy to reuse later in emails, pages, and other authoring surfaces.
- The first implementation should prove storage, editing, visibility, and replacement behavior before integration work begins.

V1 should stay minimal:

- create
- edit
- delete
- list
- copy token
- verify replacement behavior on dedicated variables pages

## Locked v1 Decisions
- Add a new main dashboard sidebar item:
  - `Variables`
- Add a new event-shell sidebar item:
  - `Variables`
- Primary organization route:
  - `/dashboard/variables`
- Primary event route:
  - `/dashboard/events/[eventId]/variables`
- Token syntax:
  - `{{VARIABLE_NAME}}`
- Variable keys should be normalized to uppercase snake case.
- Variable values are plain text in v1.
- Built-in system variables should be available by default and be read-only.
- The event variables page should show both:
  - organization variables
  - event variables
- Event-level variables should override organization-level variables with the same key when resolving inside that event.
- Built-in variable keys are reserved and cannot be created manually as custom variables.
- V1 does not integrate with email rendering yet.
- V1 does not replace or modify the existing email merge-tag system.

## Important Existing Constraint
The codebase already has an email merge-tag system with a different syntax:

- built-in email merge tags use single braces:
  - `{event_title}`
  - `{first_name}`
- those tags are lowercase snake case and come from event/attendee/order context

To avoid collisions and rollout risk:

- custom variables should use double braces:
  - `{{SUPPORT_EMAIL}}`
- the new feature should be stored and tested separately first
- email integration should be a later phase after the standalone variables pages are stable

## v1 Scope
- Add an organization-level variables page under the main dashboard shell.
- Add an event-level variables page under the event shell.
- Allow users to:
  - create a variable
  - edit a variable
  - delete a variable
  - browse existing variables
  - copy the rendered token form
  - test replacement behavior in an isolated preview/playground
- Persist organization variables by active organization/workspace.
- Persist event variables by active event and organization.
- Validate and normalize keys consistently on save.
- Make the event page show both scopes clearly.
- Show built-in defaults on both pages without requiring the user to create them manually.

Recommended behavior split:

- `/dashboard/variables`
  - manages organization variables
- `/dashboard/events/[eventId]/variables`
  - manages event variables
  - also displays organization variables for reference

Out of scope for v1:

- email editor integration
- public page builder integration
- form builder integration
- nested variables
- recursive replacement
- rich text / HTML values
- version history
- audit logs
- import/export
- secrets or encrypted values

## Information Architecture and Routes
- Add a new workspace route:
  - `/dashboard/variables`
- Add a new main dashboard sidebar item in `src/features/dashboard/nav.ts`.
- Add a breadcrumb/meta branch in `src/features/dashboard/components/dashboard-shell.tsx`:
  - `Dashboard > Variables`

- Add a new event route:
  - `/dashboard/events/[eventId]/variables`
- Add a new event-shell sidebar item in the event navigation config.
- Add event-shell breadcrumb/page-meta support for:
  - `Events > [Event Name] > Variables`

Recommended page structure:

- Organization variables page:
  - built-in organization defaults
  - organization variable library
  - create/edit flow
  - replacement playground
- Event variables page:
  - organization scope section
  - event scope section
  - resolved preview/playground using both scopes

Recommended initial files:

- `src/app/dashboard/(workspace)/variables/page.tsx`
- `src/app/dashboard/(event)/events/[eventId]/variables/page.tsx`
- `src/features/variables/components/organization-variables-page.tsx`
- `src/features/variables/components/event-variables-page.tsx`
- `src/features/variables/components/variable-dialog.tsx`
- `src/features/variables/components/variables-playground.tsx`
- `src/features/variables/schema.ts`
- `src/features/variables/utils.ts`
- `src/lib/db/adminVariable.ts`

## Data Model
Use one scoped variable model so organization and event variables share the same shape.

Suggested document shape:

- `organizationId`
- `scope`
- `eventId?`
- `key`
- `value`
- `description?`
- `createdAt`
- `updatedAt`

Suggested scope values:

- `"organization"`
- `"event"`

Notes:

- `eventId` is required when `scope === "event"`
- `eventId` is absent for organization variables
- `key` is the canonical normalized key without braces:
  - `SUPPORT_EMAIL`
  - not `{{SUPPORT_EMAIL}}`
- the inserted token is derived at render time:
  - `{{${key}}}`
- `description` is optional and only exists to help organizers remember usage
- `value` should be stored as plain text only in v1

Built-in system variables should not be stored in the same collection as custom variables.

- built-ins are derived at runtime from the current organization and event data
- custom variables are persisted
- the UI should present both together, but the persistence model should keep them separate

## Built-in System Variables
V1 should include a small starter catalog of read-only defaults so the feature is immediately useful before users create any custom variables.

Recommended initial built-ins:

### Organization built-ins
- `{{ORGANIZATION_NAME}}`

### Event built-ins
- `{{EVENT_NAME}}`
- `{{EVENT_STATUS}}`
- `{{EVENT_START_DATE}}`
- `{{EVENT_END_DATE}}`
- `{{EVENT_TIMEZONE}}`

Notes:

- built-ins should be read-only
- built-ins should have `Copy token` affordances just like custom variables
- built-ins should be visually distinguished from custom variables
- built-ins should resolve through the same replacement utility
- built-in keys are reserved and cannot be created manually
- if a date value is unavailable, the UI should still show the token and present the current fallback behavior clearly in the playground

## Key and Syntax Rules
- Input may be normalized on save:
  - trim whitespace
  - convert to uppercase
  - replace spaces and hyphens with underscores
- Allowed key characters after normalization:
  - `A-Z`
  - `0-9`
  - `_`
- Keys must start with a letter.
- Store and display the key without braces.
- Show the token preview everywhere as:
  - `{{KEY}}`

Uniqueness rules:

- organization-level keys must be unique within the organization scope
- event-level keys must be unique within the current event scope
- the same key may exist in both scopes intentionally
  - this is how event-level override works
- built-in keys are reserved and cannot be reused by custom variables

Examples:

- `support email` -> `SUPPORT_EMAIL`
- `org-name` -> `ORG_NAME`
- `followup_2026` -> `FOLLOWUP_2026`

## Replacement Behavior
V1 should include a small pure utility for resolving variables inside arbitrary text.

Suggested utility shape:

- `resolveVariables({ text, organizationVariables, eventVariables })`

Expected behavior:

- `{{SUPPORT_EMAIL}}` resolves to the matching saved value
- event-level variables are checked first
- organization-level variables are checked second
- built-in event variables are checked after custom variables
- built-in organization variables are checked last
- unknown variables remain literal in the output
- known variables with values resolve directly
- no recursive expansion in v1
- no mixed HTML interpretation in v1

Example:

- organization variable:
  - `SUPPORT_EMAIL = hello@eventa.com`
- event variable:
  - `SUPPORT_EMAIL = gym2026@eventa.com`
- input:
  - `Contact us at {{SUPPORT_EMAIL}}.`
- output when resolved inside the event:
  - `Contact us at gym2026@eventa.com.`
- output when resolved at organization scope only:
  - `Contact us at hello@eventa.com.`

Keeping unknown tokens literal is safer for the first rollout because typos stay visible instead of silently disappearing.

## UX Plan
The pages should stay clean and minimal.

### Organization variables page
- Show a `Built-in defaults` section first.
- Include read-only items such as:
  - `{{ORGANIZATION_NAME}}`
- List organization variables in a simple table or stacked cards.
- Show:
  - key
  - token preview
  - value
  - optional description
  - updated time
- Include actions:
  - `Add variable`
  - `Edit`
  - `Delete`
  - `Copy token`

### Event variables page
- Show two clearly separated scope sections:
  - `Organization scope`
  - `Event scope`
- Each scope section should include:
  - built-in defaults
  - custom variables
- The organization scope should be visible for reference so the user understands what is already shared.
- The event scope should show local variables for the current event.
- The page should make override behavior obvious when the same key exists in both scopes.

Recommended event-page treatment:

- organization variables:
  - visible on the page
  - read-only in v1
  - include a link back to `/dashboard/variables` for editing shared values
- organization built-ins:
  - visible on the page
  - read-only
- event variables:
  - fully editable on the event page
- event built-ins:
  - visible on the page
  - read-only

### Create/Edit flow
- Use a focused dialog or side panel for variable editing.
- Fields:
  - key
  - value
  - optional description
- Show the live rendered token preview as the key is typed:
  - `{{KEY}}`
- Show validation errors before save.

### Verification playground
- Add a lightweight text area where the user can paste sample content containing `{{VARIABLE}}` tokens.
- Show:
  - original input
  - resolved preview
  - optional warnings for unknown keys found in the text

Playground behavior:

- organization page resolves using:
  - organization custom variables
  - organization built-ins
- event page resolves using:
  - event custom variables
  - organization custom variables
  - event built-ins
  - organization built-ins

This playground is the main way to verify the feature works before integrating it elsewhere.

## Scoping Rules
- Organization variables belong to the active organization/workspace.
- Event variables belong to one event within the active organization.
- The organization page must only load organization variables for the active organization.
- The event page must only load:
  - the current event's event variables
  - the active organization's organization variables
- The feature should reuse the same dashboard session and organization-scope rules as other pages.
- V1 does not need a brand new permission model.
- Granular access control can be revisited later if variables become heavily used by email or page workflows.

## Persistence and Uniqueness
- Save variables through server-side scoped data access.
- Normalize keys before uniqueness checks.
- Prefer server-side validation over trusting client formatting alone.

Uniqueness checks should enforce:

- no duplicate organization-level key within the same organization
- no duplicate event-level key within the same event

V1 should allow:

- one organization variable `SUPPORT_EMAIL`
- one event variable `SUPPORT_EMAIL` for Event A
- one different event variable `SUPPORT_EMAIL` for Event B

## Public APIs, Interfaces, and Services
- Add Zod schema(s) for:
  - variable document
  - create/update payload
- Add admin DAL helpers for:
  - list organization variables
  - list event variables
  - create variable
  - update variable
  - delete variable
- Add a pure replacement helper that can be reused later by email and page features.
- Add runtime builders for the built-in catalogs:
  - organization built-ins from organization data
  - event built-ins from event data

Possible route/action shapes:

- organization scope:
  - `GET /api/dashboard/variables`
  - `POST /api/dashboard/variables`
  - `PATCH /api/dashboard/variables/[variableId]`
  - `DELETE /api/dashboard/variables/[variableId]`
- event scope:
  - `GET /api/dashboard/events/[eventId]/variables`
  - `POST /api/dashboard/events/[eventId]/variables`
  - `PATCH /api/dashboard/events/[eventId]/variables/[variableId]`
  - `DELETE /api/dashboard/events/[eventId]/variables/[variableId]`

Server actions would also be acceptable if they fit the existing pages better.

## Future Integration Path
Once the isolated pages are working and trusted, later phases can integrate variables into:

- email subject/body authoring
- page builder text blocks
- confirmation copy
- organization settings copy

Deferred design questions for the later integration phase:

- Should email content support both:
  - built-in merge tags like `{event_title}`
  - custom variables like `{{SUPPORT_EMAIL}}`
- In what order should those two systems resolve?
- Should a variable value itself be allowed to contain built-in email merge tags?
- Should editors get:
  - `Insert organization variable`
  - `Insert event variable`
  - `Insert merge tag`
- Should some integrations expose only event resolution contexts while others expose organization-only contexts?

Those questions should stay out of v1 implementation.

## Suggested Implementation Phases
1. Add the markdown plan.
2. Add route, nav, and breadcrumb wiring for:
   - `/dashboard/variables`
   - `/dashboard/events/[eventId]/variables`
3. Add scoped variable schema, types, and DAL helpers.
4. Build the organization variables page.
5. Build the event variables page with both visible scopes.
6. Add the isolated replacement playground and pure resolver utility.
7. Verify behavior with tests and manual dashboard QA.
8. Later, design and ship integrations into email or other text-authoring surfaces.

## Test Plan
- Navigation:
  - main dashboard sidebar shows `Variables`
  - event sidebar shows `Variables`
  - `/dashboard/variables` loads in the workspace shell
  - `/dashboard/events/[eventId]/variables` loads in the event shell
- Breadcrumbs:
  - main page shows `Dashboard > Variables`
  - event page shows `Events > [Event Name] > Variables`
- Organization create/edit/delete:
  - create a new organization variable with a valid key and value
  - verify the key is normalized correctly
  - verify the token preview renders as `{{KEY}}`
  - edit and delete organization variables successfully
- Event create/edit/delete:
  - create a new event variable with a valid key and value
  - edit and delete event variables successfully
- Built-ins:
  - organization page shows built-in organization defaults without manual setup
  - event page shows built-in organization and event defaults without manual setup
  - built-ins cannot be edited or deleted
  - custom variables cannot be created using reserved built-in keys
- Validation:
  - reject invalid characters
  - reject keys that do not start with a letter
  - reject duplicate keys within the same scope
- Scope visibility:
  - organization page only shows organization variables
  - event page shows both organization and current-event variables
  - event page does not show event variables from other events
- Override behavior:
  - if only organization variable exists, it resolves
  - if both organization and event variable exist with the same key, event value wins on the event page
- Playground:
  - known variables resolve correctly
  - unknown variables remain literal
  - repeated variables resolve in all occurrences
  - empty text behaves safely

## Acceptance Criteria
- A markdown plan exists in `docs/workspace-variables-v1-plan.md`
- The plan defines a new main dashboard tab for organization variables
- The plan defines a new event-level variables page
- The plan defines:
  - `/dashboard/variables`
  - `/dashboard/events/[eventId]/variables`
- The plan defines both organization and event scoping
- The plan defines `{{VARIABLE_NAME}}` syntax
- The plan defines event-overrides-organization behavior within an event
- The plan defines built-in read-only defaults like `{{ORGANIZATION_NAME}}` and `{{EVENT_NAME}}`
- The plan explicitly keeps v1 isolated from the existing email merge-tag system
- The plan includes a verification playground on both variables pages
- The plan records future integrations as later work, not v1 scope

## Assumptions
- Organization variables are shared by all users in the active organization.
- Event variables are only for one event.
- Plain-text values are enough for the first pass.
- Keeping the feature isolated first is more valuable than rushing direct email integration.
- `Variables` is a clearer umbrella name than `Template Variables` because `template` already means something else in this product.
- In v1, the event page should display organization variables but edit only event variables locally, while shared organization values remain managed from the organization dashboard page.
