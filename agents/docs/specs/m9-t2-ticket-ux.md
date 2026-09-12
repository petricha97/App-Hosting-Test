# M9-T2 — Simplified ticket setup

User-approved reference: `/Users/yubeikoe/Documents/Codex-Mockups/ticket-flow/simplified-ticket-flow.html` and the conversation's clarification on code generation. This builds on the uncommitted M9-T1 wizard without discarding existing work.

## Acceptance criteria and design

1. Preserve the three steps: Ticket details, Audience & price, Review & publish. Use existing app components and theme tokens, accessible labels, responsive layout, and concise copy.
2. Ticket details shows Ticket name and Ticket quantity (Unlimited by default / Set quantity). An optional Schedule ticket sales toggle reveals date fields. Turning scheduling off excludes both dates. Validate real calendar dates and order. Preserve choices when navigating backward.
3. Advanced settings contains the ticket code. Generate a valid uppercase, at-most-12-character code from the name while creating; stop automatic updates after manual code editing. Renaming a saved ticket never changes its code automatically. Handle empty/non-Latin names with a valid fallback. Show hidden code validation/server collision errors by opening Advanced settings.
4. Remove the availability switch from creation: Publish enables the ticket, still subject to sales dates and capacity. Review uses clear names and reflects the actual payload.
5. Audience & price retains existing audience selection and per-audience pricing. Keep a visible Add registration type action. Inline creation collects name and this ticket's price; code auto-generation and optional audience-wide capacity live under Advanced settings. Successful creation includes the new audience with its entered price. Existing immediate persistence semantics remain; no Firestore outside the DAL. Block navigation/closing while the mini-form is saving; don't discard an open draft by advancing.
6. For events with no registration types, offer a preselected General attendee row requiring only its price. Resolve it through an authenticated, idempotent ensure-default endpoint only on explicit submission/advance, not on opening the wizard. Existing events retain their actual audience options. The endpoint must scope all reads/writes to event and organization; retries must not duplicate the default. Reuse the normal registration type and final ticket+fees transaction rather than inventing unrestricted pricing semantics.
7. Existing ticket rows have Pause sales / Resume sales actions. Update only isOpen using a dedicated authenticated endpoint so stale UI data cannot overwrite name/capacity/pricing/sales dates. Resume never overrides dates or quantity limits. Show pending state, errors, and accurate sales status.
8. Apply the same simplified labels and advanced audience capacity to standalone registration-type creation/editing. Existing ticket editing preserves identifiers and dates. Keep the secondary ticket-only creation flow consistent where practical.
9. Preserve validation, server code uniqueness checks, pricing currency (existing USD contract), fee creation, permission checks, and multi-tenant isolation. No currency or data migration is implied by the illustrative mockup.
10. Add meaningful tests for generation/manual override, state across navigation, date scheduling, retained inline creation/price, default type behavior, pause/resume isolation and error handling. Execute focused tests, typecheck, lint/build, full tests; report pre-existing/environment failures honestly.

## Assignments

- Full-Stack developer: wizard and client-side schema/generation helper.
- Backend agent: default registration type and ticket sales endpoints/DAL with regression tests.
- Full-Stack management UI: registration dialogs and ticket workspace actions.
- Code Reviewer, then Security, then QA: review final combined changes under repository role instructions.

Existing uncommitted files and staged configuration are user work. Preserve them. No deployment is included in this implementation task.
