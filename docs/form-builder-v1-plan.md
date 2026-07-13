# Form Builder v1

## Summary
- First deliverable is a design and implementation reference for the event-owned registration form builder.
- This document defines the v1 scope for organizer form creation, field ordering, required participant fields, and later participant submission flow.
- The first implementation should focus on one primary registration form per event, with a smooth builder experience inside `/dashboard/events/[eventId]/form`.

## Product Direction
- The form builder is organization-scoped through the owning event.
- Each event should have one primary registration form in v1.
- Organizers must always collect the minimum participant information needed to register attendees.
- Organizers can add custom fields when the event requires more information.
- The builder should feel simple, visual, and safe to edit, not like a raw database editor.

Locked v1 decisions:
- forms are event-owned
- the primary builder route is `/dashboard/events/[eventId]/form`
- required participant fields are:
  - first name
  - last name
  - email
- organizers can add custom fields after the required fields
- field order should be editable with drag and drop
- participant submissions will later be stored in `FormData`

## Route and Ownership Model
- Organizer builder route: `/dashboard/events/[eventId]/form`
- Event-level access rules:
  - user must belong to the organization that owns the event
  - the builder should only load the form for that event and organization
- Participant-facing form route can be added later and should read only published form data

## v1 Scope
- Load an event-owned form for the current event
- If no form exists yet, initialize a default draft form
- Render required locked fields at the top
- Allow organizers to add custom fields
- Allow organizers to reorder fields
- Allow organizers to edit field settings
- Prevent deletion of mandatory locked fields
- Provide a preview mode for the participant-facing experience
- Save form changes back to Firestore

Out of scope for the first pass:
- conditional logic
- nested groups or sections
- multi-page forms
- payment configuration
- advanced response exports
- public participant submission route

## Information Architecture
- Desktop layout should use a three-part workspace:
  - field palette
  - builder canvas
  - selected field settings
- Mobile and tablet should stack the same pieces in a sensible order:
  - builder canvas first
  - field palette second
  - field settings last
- The builder should fit naturally inside the dashboard shell and benefit from the collapsible sidebar.

## Field Model
- Each form document should contain:
  - `eventId`
  - `organizationId`
  - `title`
  - `status`
  - `fields`
  - `createdAt`
  - `updatedAt`

- Each field entry in `fields[]` should include:
  - `id`
  - `key`
  - `label`
  - `type`
  - `placeholder`
  - `helpText`
  - `required`
  - `isMandatory`
  - `order`

- Optional per-type config can be added later:
  - `rows` for textarea
  - `options` for select, radio, or checkbox groups

## Required Fields
- Mandatory fields should be created automatically when a new event form is initialized.
- v1 mandatory fields:
  - `first_name`
  - `last_name`
  - `email`
- Mandatory field behavior:
  - cannot be deleted
  - should stay above organizer-added custom fields by default
  - label/help text may be editable if useful
  - `isMandatory` should be stored on the field object

## Supported Field Types for v1
- `text`
- `email`
- `textarea`

Second-wave field types:
- `phone`
- `select`
- `radio`
- `checkbox`

## Firestore and Schema Notes
- The current Firestore screenshots suggest the `Form` collection already contains:
  - `title`
  - `fields[]`
  - `createdAt`
  - `updatedAt`
- Participant submissions should later be stored in `FormData`.
- The codebase should use the same pattern already used for events:
  - Zod schema for runtime validation
  - derived TypeScript types
  - Firestore collection helpers through the existing factory pattern

Recommended code artifacts:
- `src/features/form/schema.ts`
- `src/features/form/default-fields.ts`
- `src/features/form/utils.ts`
- `src/lib/db/form.ts`
- `src/lib/db/adminForm.ts`
- later:
  - `src/lib/db/formData.ts`
  - `src/lib/db/adminFormData.ts`

## Technical Decisions
- Use Zod for:
  - form document schema
  - field schema
  - future participant submission schema
- Use the Firestore factory pattern for client and admin collection helpers.
- Use shadcn components for forms, cards, buttons, tabs, panels, and field editing controls.
- Use `@dnd-kit` for field reordering.
  - This is the preferred drag-and-drop library for the builder v1 implementation.

## UX Plan
- Builder canvas:
  - shows the current ordered fields
  - supports selecting a field to edit
  - supports drag handle reordering
- Field palette:
  - quick-add buttons for supported field types
  - only a few field types in v1 to keep the product simple
- Field settings panel:
  - label
  - placeholder
  - help text
  - required toggle
  - rows for textarea when relevant
- Preview mode:
  - renders the participant-facing form from the same field configuration
  - read-only in v1

## Organization Scoping
- Forms must be filtered by the event and the owning organization.
- The builder must not load or update forms outside the active organization scope.
- Event lookup should remain server-side or admin-scoped where required by current Firestore rules.
- Form creation should attach:
  - `eventId`
  - `organizationId`

## Persistence Behavior
- When the builder loads:
  - find the event-owned form for the current event and organization
  - if missing, initialize a new draft form with mandatory fields
- When the organizer saves:
  - persist the current ordered field list
  - update `updatedAt`
  - preserve mandatory field constraints

## Suggested Implementation Phases
1. Add schema and default field definitions
2. Add client and admin Firestore helpers for `Form`
3. Replace the form-builder scaffold route with a real loader and workspace
4. Add field creation and field settings editing
5. Add drag-and-drop reordering with `@dnd-kit`
6. Add preview mode
7. Later, add participant submission and `FormData`

## Acceptance Criteria
- A markdown plan exists in `docs/form-builder-v1-plan.md`
- The plan defines one primary registration form per event
- The plan records the required locked fields
- The plan defines the v1 field types
- The plan records drag-and-drop as part of the builder experience
- The plan records that forms are organization-scoped through the owning event
- The plan separates builder work from future participant submission work

## Assumptions
- One form per event is sufficient for v1
- Forms belong to events, not directly to the organization root
- Existing Firestore data may need normalization to match the final schema
- The first build should optimize for a usable organizer workflow before supporting every field type
