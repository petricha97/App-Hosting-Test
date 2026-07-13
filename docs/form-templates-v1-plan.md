# Form Templates v1 for Event Registration Forms

## Summary
Add an organization-scoped `FormTemplate` layer that sits above event-owned forms.

- Organizers manage templates under the existing `Forms` area, not as a separate sidebar item.
- When an event has no form yet, the organizer chooses `Start from template` or `Start from scratch`.
- Forms created from templates stay linked by default, similar to prefab instances.
- Template updates can be applied later to some or all linked event forms, including forms for past events and live published events, with a clear warning step.
- While a form is still linked, template-owned fields are managed by the template; the event form can add local extra fields and can detach if it needs one-off edits.

## Key Changes
### Information architecture and routes
- Turn `/dashboard/forms` into the org-level forms hub with two sections:
  - `Event Forms`
  - `Templates`
- Add template routes under the existing forms area:
  - `/dashboard/forms/templates`
  - `/dashboard/forms/templates/new`
  - `/dashboard/forms/templates/[templateId]`
- Keep `/dashboard/events/[eventId]/form` as the event form builder route.
- Change the first-load behavior for `/dashboard/events/[eventId]/form`:
  - if a form already exists, open the builder normally
  - if no form exists, show a creation chooser with:
    - `Use template`
    - `Start from scratch`
- Reuse the current form builder UI and builder mechanics for templates where possible, rather than building a separate editor from zero.

### Data model and type changes
- Add a new `FormTemplateDoc` in the shared collection types and use the existing Firestore collection name `FormTemplate`.
- `FormTemplateDoc` should include:
  - `organizationId`
  - `title`
  - `description`
  - `status: "active" | "archived"`
  - `version: number`
  - `fields`
  - `createdAt`
  - `updatedAt`
- Reuse the current field model for templates, with the same supported field types as the form builder v1.
- Extend `FormDoc` with template-link metadata:
  - `templateLink?: { templateId: string; templateVersion: number; detached: boolean; appliedAt: Timestamp | FieldValue }`
- Extend form fields on event-owned forms with origin metadata so apply-updates can work safely:
  - `origin: "mandatory" | "template" | "event"`
  - `sourceTemplateFieldId?: string`
- Keep `FormData` unchanged for this feature; public and dashboard submission flows continue to write against the final event-owned form.

### Template and linked-form behavior
- Templates are organization-scoped and shared across users in the same organization.
- Templates are managed under the existing `view:form` / `write:form` permissions in v1.
- Creating a form from a template should:
  - copy the template fields into a new event-owned form
  - stamp `templateLink`
  - mark copied fields as `origin: "template"` with `sourceTemplateFieldId`
  - preserve the mandatory fields through the template itself, not by re-adding a second time
- Starting from scratch should keep the current form-builder behavior with mandatory fields auto-created.
- While an event form remains linked:
  - template-owned fields cannot be edited directly in the event form
  - the event form can add local extra fields
  - the event form can manage its own event-only fields
  - the organizer can detach the form from the template to unlock one-off editing
- Detaching should:
  - mark the form as detached in `templateLink`
  - stop future template update suggestions for that form
  - convert template-owned fields into normal event fields for ongoing editing

### Template updates and apply flow
- Editing a template increments `version`.
- Any linked form whose `templateLink.templateVersion` is older than the template version should show `Template update available`.
- Applying template updates should start from the template detail page, with actions:
  - `Apply to selected forms`
  - `Apply to all linked forms`
- V1 apply behavior should be safe and predictable:
  - matching template-owned fields update by `sourceTemplateFieldId`
  - added template fields are inserted into the template-managed block in template order
  - removed template fields are kept by default on the event form as local event fields so no data is silently lost
  - event-only extra fields remain untouched
- Linked forms remain eligible for updates even when:
  - the event is over
  - the event is published
  - the public form is live
- Because live/public forms can be updated, the apply flow must show a clear warning before bulk update when any selected linked form is currently published or tied to a published event.

### Builder and dashboard UX
- Template index should show:
  - title
  - description
  - version
  - status
  - number of linked forms
  - updated time
- Event form chooser should show:
  - recent/active templates for the organization
  - a scratch option
  - short preview info like field count and last updated time
- Linked event forms should show:
  - source template name
  - current linked version
  - whether updates are available
  - a `Detach` action
  - a `Manage template` link back to the template
- Templates should use the same drag-and-drop builder experience as event forms, but in template mode.

## Public APIs, Interfaces, and Services
- Add Zod schemas for:
  - `FormTemplateDoc`
  - template builder payloads
  - template apply-update request payload
- Add Firestore helpers following the existing factory pattern:
  - client and admin `FormTemplate` helpers
  - admin query helpers for linked event forms by template
- Add server routes/actions for:
  - create template
  - update template
  - create event form from template
  - detach event form from template
  - apply template updates to selected/all linked forms
- Keep public registration APIs unchanged; they should continue reading the resolved event-owned form only.

## Test Plan
- Template creation:
  - create a template from scratch
  - edit and save a template
  - archive a template and verify it disappears from the default picker
- Event form creation:
  - create an event form from scratch
  - create an event form from a template
  - verify linked metadata is stored on template-based forms
- Linked-form editing:
  - verify template-owned fields are not editable while linked
  - verify event-only extra fields can be added
  - detach a linked form and verify full editing becomes available
- Template update flow:
  - update a template and verify linked forms show `update available`
  - apply to selected forms only
  - apply to all linked forms
  - verify added template fields appear
  - verify removed template fields are preserved as local event fields
  - verify event-only extra fields stay untouched
- Event-status scenarios:
  - apply updates to a draft event form
  - apply updates to a published event form
  - apply updates to an event that is already over
  - verify warning UI appears when updating forms tied to live published events
- Registration compatibility:
  - verify public and dashboard registration still render and submit correctly after a form is template-derived
  - verify `FormData` submission still uses the resolved final event-owned form shape

## Assumptions and Defaults
- Templates are organization-scoped and shared across the workspace.
- Templates live under the existing `Forms` area, not a new sidebar section.
- Linked forms follow a prefab-style model by default.
- V1 uses `view:form` / `write:form` permissions for templates instead of introducing separate template permissions.
- V1 prioritizes safe centralized management over maximum local override freedom: linked forms can add local extra fields, but template-owned fields stay managed by the template unless detached.
