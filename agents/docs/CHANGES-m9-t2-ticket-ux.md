# Simplified ticket setup — implementation notes

Implemented the approved ticket mockup on top of the existing M9-T1 wizard. All pre-existing staged configuration and uncommitted ticket work were preserved.

## User-visible changes

- Ticket creation starts with Ticket name and Ticket quantity. Scheduling is optional; disabling it excludes both dates from review and submission.
- Ticket code lives under Advanced settings and follows the name during creation until manually edited. Saved codes remain stable on rename. Code errors reveal the advanced field.
- Audience & price retains Add registration type, now with name and ticket price upfront. Registration-type code and audience-wide capacity are advanced options. Added types are included with the entered price and remain available if the wizard is closed before publication.
- Events without registration types start with General attendee. Only an explicit continuation creates it; retries reuse the saved audience without resetting its limit.
- Publish enables the ticket subject to dates and quantity. Existing tickets have Pause sales / Resume sales actions that update only the sales flag. Status distinguishes Paused, Scheduled, Ended, Sold out, Needs pricing and On sale. A valid free price is supported.
- Standalone ticket and registration-type dialogs use consistent simplified controls. Existing USD pricing and server validation remain in place.

## Implementation and review

The existing ticket-plus-fees transaction remains authoritative. Two authenticated endpoints add idempotent default-audience setup and narrowly scoped sales updates. No new collection or document migration is required. The corresponding Firestore index is included in `firestore.indexes.json`; provisioning is part of deployment.

Reviews: `reviews/m9-t2-backend.md`, `reviews/m9-t2-management.md`, `reviews/m9-t2-wizard.md` — all APPROVED. Security: `security/m9-t2-ticket-ux.md` — PASS. QA details: `qa/m9-t2-ticket-ux.md`.

## Final checks

- 81 feature tests pass, covering wizard/schema/generation, management UI, authorization and DAL behavior.
- Full suite: 2268 pass; one pre-existing email source-hash assertion fails, identical to the pre-change baseline.
- `npm run lint`: pass.
- `npm run build`: pass in an isolated copy of the final source, with the existing dependencies, so the live development server's build directory is untouched.
- Standalone `tsc --noEmit`: ten errors in unrelated existing test fixtures; no changed feature errors. Next's production build completes successfully.
- Earlier browser checks verified ticket-only code generation and preservation of a manual override. Final wizard visual, responsive and theme checks remain unverified because the signed-in browser session expired and later no browser connection was available. No test registrations or tickets were published to live-backed data.

Changes remain local on `prototype-v2`, without a commit, merge or deployment.
