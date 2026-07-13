# Event Pages v1 Plan

## Summary
Add a public event-page system that gives organizers three choices per event:

- use the default event page
- design a custom event page inside the app
- redirect visitors to an external event page

This feature should stay friendly for organizers, fit the current Firebase stack, avoid paid vendor lock-in, and leave room for future AI-assisted page generation.

For v1, the recommended stack is:

- `Puck` for the embedded visual page builder
- `Cloud Storage for Firebase` for organizer-uploaded images/assets
- `Firestore` for event page configuration and builder JSON

## Product Goals
- Keep the public event experience simple and reliable.
- Give organizers enough flexibility to add their own text, images, and section order without turning the app into a fully open website builder.
- Preserve a strong product opinion by limiting editing to approved blocks/components.
- Support a future AI flow where a prompt can generate a first draft page.
- Keep the event registration form and event metadata integrated with the custom page, not separate from it.

## Recommended Approach
Treat this as an embedded page-builder feature, not a generic headless CMS integration.

Use `Puck` as the in-app visual editor because it is:

- open source
- React/Next-friendly
- component-driven
- easier to constrain than a raw HTML/CSS builder
- a better fit for future AI-generated structured layouts

Avoid giving organizers unconstrained HTML editing in v1.

## Organizer Choices
Each event should support a new page mode:

- `default`
- `custom`
- `redirect`

### Default
Render the app’s standard public event detail template using event data and the published registration form.

### Custom
Render a saved page-builder document for the event using approved components and uploaded assets.

### Redirect
Skip the in-app public event page and redirect users to an organizer-provided URL.

## Data Model
Extend the event model with public-page configuration:

- `pageMode: "default" | "custom" | "redirect"`
- `redirectUrl?: string`
- `pageStatus?: "draft" | "published"`
- `pageTemplateKey?: string`
- `pageBuilderVersion?: number`
- `pageContentPath?: string`
- `pageUpdatedAt?: Timestamp`

Keep the builder document itself separate from the event document. The event should only store routing and mode metadata, not the full custom page body.

Recommended `EventPage` document:

- `eventId`
- `organizationId`
- `mode`
- `status`
- `title`
- `description`
- `draftContent`
- `publishedContent`
- `seo`
- `publishedAt`
- `createdAt`
- `updatedAt`

Recommended builder content shape:

- `root`
- `zones`
- `content`
- builder-specific block props JSON

Recommended publish model:

- organizers edit `draftContent`
- public routes render `publishedContent`
- publishing copies the current draft into the published snapshot

This avoids exposing unfinished edits to public visitors and keeps the public render path stable.

For v1, it is acceptable to store the builder JSON directly in Firestore as long as it stays reasonably sized. If page JSON grows too large later, keep the event/page metadata in Firestore and move the full builder JSON into Storage with a Firestore pointer.

## Cost and Size Guardrails
Text by itself is usually not the main Firebase cost risk. The more important risks are:

- large Firestore documents
- repeated writes
- uploaded media
- public traffic

To keep the feature predictable in v1, the editor should enforce limits instead of allowing arbitrary unlimited layout data.

Recommended guardrails:

- maximum `20` blocks per page
- maximum `10` images per page
- hero heading max `120` characters
- standard text/title field max `200` characters
- paragraph/rich text field max `3,000` characters
- FAQ answer max `800` characters
- no raw HTML block in v1
- no custom script/embed block in v1
- no full revision history in v1 beyond one draft and one published snapshot

These limits keep the content manageable, help the page stay readable, and reduce the risk of oversized Firestore documents.

## Storage Strategy
Use `Cloud Storage for Firebase` for uploaded page assets.

Recommended path convention:

- `organizations/{organizationId}/events/{eventId}/assets/...`
- `organizations/{organizationId}/event-pages/{eventId}/...`

Store metadata in Firestore:

- storage path
- public URL or generated download URL
- alt text
- original filename
- uploadedAt

V1 asset types:

- hero images
- section images
- gallery images

Keep uploads authenticated and organization-scoped. Public users should only access assets referenced by published event pages.

Important storage rule:

- text/layout JSON belongs in Firestore
- image/video assets belong in Firebase Storage

Do not store large image blobs or base64 media in Firestore.

## Builder Scope
The custom page editor should not be fully freeform in v1.

Allow approved blocks/components only:

- `Hero`
- `RichText`
- `Image`
- `Gallery`
- `Schedule`
- `Venue`
- `Speakers`
- `FAQ`
- `CTA`
- `RegistrationEmbed`
- `Divider`
- `TwoColumn`

Important rule:

- the organizer can control text, images, alignment, and section order
- the organizer cannot inject arbitrary scripts, raw custom HTML, or unknown component types
- the organizer cannot create unbounded nested freeform div trees in v1

This keeps the page safe, branded, and manageable.

## Registration Integration
The event page system must stay tied to the existing event form flow.

Rules:

- `default` pages render the current public registration form at the usual place
- `custom` pages expose a `RegistrationEmbed` block that renders the published event form
- `redirect` pages do not render the in-app event page unless you later decide to support a fallback preview

Published-page behavior:

- public visitors should only see the registration form when:
  - the event is published
  - the form exists
  - the form itself is published

If no published form exists, show a clear `registration not available yet` state.

## Dashboard UX
Add event-page controls to the organizer event workflow.

Recommended event detail actions:

- `Use default page`
- `Design custom page`
- `Redirect to external page`
- `Preview public page`
- `Publish page`

Recommended route additions:

- `/dashboard/events/[eventId]/page`
- `/dashboard/events/[eventId]/page/preview`

V1 editor flow:

1. Organizer opens event detail
2. Chooses `default`, `custom`, or `redirect`
3. If `custom`, opens the embedded builder
4. Adds blocks, text, and images
5. Saves draft
6. Previews page
7. Publishes page

## Public Routing
The existing public event route should continue to exist:

- `/events`
- `/events/[eventId]`

Behavior:

- if `pageMode === "redirect"` and the event is published, redirect to `redirectUrl`
- if `pageMode === "custom"` and the page is published, render the saved builder page
- otherwise render the default event detail page

Draft pages must never leak publicly.

## AI-Ready Direction
The event-page builder should be designed so AI can generate structured page content later.

Future AI flow:

1. Organizer enters a prompt
2. App generates a proposed page structure using approved blocks
3. Generated output becomes editable Puck JSON
4. Organizer refines it in the visual editor

Because of that, builder blocks should have clear schemas and predictable props.

Examples of future prompt ideas:

- `Create a wellness event page with a calm hero, class schedule, trainer section, and signup CTA`
- `Make this look like a startup conference with speakers, agenda, FAQ, and sponsor section`

## Open Source Evaluation Summary
### Puck
Recommended for v1.

Why:

- React-native and embeddable
- open source
- easy to constrain to approved blocks
- works well with structured AI output later

### GrapesJS
Possible alternative, but less preferred.

Why not first choice:

- more freeform than needed
- heavier mental model
- easier for users to break visual consistency

### Craft.js
Good lower-level option, but higher engineering effort.

Why not first choice:

- flexible but less turnkey for a CMS-like experience
- more work to build a polished editor from scratch

### Decap CMS
Not recommended for this feature.

Why:

- git-oriented CMS, not a natural fit for Firebase event pages
- not aligned with event documents and in-app page ownership

## Technical Architecture
### Schemas
Add Zod schemas for:

- event page config on the event document
- event page document
- builder content
- uploaded asset metadata

### Firestore helpers
Add factory-pattern helpers for:

- `EventPage`
- event page asset metadata if stored separately

Server/admin helpers should handle:

- create page
- update page
- publish page
- load published page
- load editable draft page

### Rendering
Split rendering into:

- dashboard editor renderer
- public page renderer

The public renderer must only support approved block types.

## Permissions
Use organization-scoped permissions.

V1 can stay under existing event/form write permissions if needed, but the cleaner long-term path is to add:

- `view:event-page`
- `write:event-page`

At minimum:

- only org members with write access can edit event pages
- only published event pages are public
- only org-scoped assets can be managed by authorized users

## Test Plan
### Default page mode
- published event renders the normal public event detail page
- draft event stays hidden from public routes

### Custom page mode
- organizer can save a draft custom page
- organizer can upload and use images
- public users only see the page after publish
- published registration form renders correctly inside the custom page

### Redirect mode
- published event redirects to the external URL
- invalid redirect URLs are blocked at validation time

### Assets
- uploaded files are organization-scoped
- published event pages can render referenced images
- draft assets do not leak unintentionally

### AI readiness
- builder blocks remain schema-driven
- saved JSON is structured enough for future AI generation

## Recommended v1 Build Order
1. Add event page mode to the event model
2. Add default/custom/redirect controls in dashboard event detail
3. Add `EventPage` document model and helpers
4. Add custom page draft editor route with Puck
5. Add Firebase Storage upload support for page images
6. Add public page rendering for published custom pages
7. Add `RegistrationEmbed` block
8. Add page preview and publish flow

## Assumptions
- The current `/events/[eventId]` route remains the public entrypoint.
- Custom event pages should stay tightly constrained in v1.
- Firebase remains the primary backend for page config and media.
- No paid SaaS CMS, trial account, or third-party hosted editor dependency should be required.
- AI generation is a future enhancement, not a v1 dependency.
