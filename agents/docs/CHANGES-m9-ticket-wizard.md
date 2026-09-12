# M9-T1 — Create Ticket wizard: what changed

Read this to know exactly what got created or touched, and in what order to review it. Every file below has its own header comment explaining what it is; every non-trivial function has a comment explaining what it does. This doc is the index — the code is the source of truth.

**Full trail, if you want the reasoning behind any decision:**
- Spec (the contract everything below implements): `agents/docs/specs/m9-ticket-wizard.md`
- Code Review: `agents/docs/reviews/m9-t1-ticket-wizard.md` — APPROVED
- Security: `agents/docs/security/m9-t1-ticket-wizard.md` — PASS, 0 Critical/High/Medium
- QA: `agents/docs/qa/m9-t1-ticket-wizard.md` — SIGNED OFF, 0 defects
- Backlog entry: `agents/docs/BACKLOG.md` → `## M9 — Registration UX (Create Ticket wizard)`

**Suggested reading order:** backend contract first (1→4 below), then the UI that calls it (5→10), then the tests (11→14), then the one modified file (15).

---

## New files

### Backend / data layer

1. **`src/features/ticket-wizard/schemas.ts`**
   The Zod payload schema for the wizard's final submit (`ticketWithPricingPayloadSchema`) — ticket fields identical to the existing ticket schema, plus a `prices` array of `{ registrationTypeId, basePriceMinor }`. This is the single place that defines what the wizard is allowed to send to the server. The bottom half (below a marker comment) has the client-side form schemas the wizard's React components use — kept in the same file so both sides of the contract stay in sync.

2. **`src/lib/db/adminTicketTypeWithPricing.ts`**
   The one function that actually writes to the database: `createAdminTicketTypeWithPricing`. Runs a real Firestore *transaction* (not a simple batch) that (a) checks the ticket code isn't already taken, (b) checks every selected registration type really belongs to this event, then (c) creates the ticket and every priced Fee row together — all-or-nothing. If step (a) or (b) fails, nothing is written at all, not even a partial ticket.

3. **`src/lib/fees/wizard-fee-name.ts`**
   Small helper, `generateWizardFeeName`. The wizard never asks you to type a name for each price row, so this builds one automatically (e.g. `"GC Summit — Delegate (USD)"`), safely trimmed if it would run too long.

4. **`src/app/api/dashboard/events/[eventId]/tickets/with-pricing/route.ts`**
   The new API endpoint the wizard's final step calls: `POST .../tickets/with-pricing`. Checks you're allowed to edit this event, validates the request against the schema in (1), then calls the transaction in (2). Your existing `POST .../tickets` endpoint (the old ticket-only create) is completely untouched — this is a new, separate route sitting next to it.

### Frontend / wizard UI

5. **`src/features/ticket-wizard/components/create-ticket-wizard.tsx`**
   The wizard shell — the dialog itself, the step indicator at the top, and the logic that decides which step you're on and what happens on Back/Continue. Also handles what happens if the final save fails (e.g. sends you back to Step 1 if the ticket code was a duplicate, or Step 2 if a price was invalid).

6. **`src/features/ticket-wizard/components/step-details.tsx`**
   Step 1: ticket name, code, capacity, sales window, open/closed toggle. Same fields as the existing ticket dialog, minus the "who can buy it" part (that moved to Step 2, next to price).

7. **`src/features/ticket-wizard/components/step-audience-pricing.tsx`**
   Step 2: the table of registration types, each with a checkbox and a price field. This is the step that replaces the old "go create a Fee on a different page" step — price now sits right next to the audience it belongs to.

8. **`src/features/ticket-wizard/components/registration-type-quick-add.tsx`**
   The "+ New registration type" mini-form inside Step 2 — **this is the answer to the question you asked earlier.** Clicking "Add" here saves a real registration type immediately, using your existing Registration Types page's own save logic. It is not held until the wizard finishes — if you close the wizard right after adding one, it's already a permanent row and will show up on the Registration Types page. QA specifically wrote a test proving this (see #13 below).

9. **`src/features/ticket-wizard/components/step-review.tsx`**
   Step 3: a read-only summary of everything you're about to create, then the final "Create ticket" button.

10. **`src/features/registration/components/ticket-types-workspace.tsx`** *(modified — see #15)*

---

## New tests

11. **`src/__tests__/tickets-with-pricing-route.test.ts`** — tests the new API endpoint directly: valid requests succeed, bad codes/prices/ids get rejected with the right error, permissions are enforced.

12. **`src/__tests__/admin-ticket-type-with-pricing.test.ts`** — tests the transaction function itself against a fake database: proves that a failure really writes *zero* documents (no half-created ticket), and that a success writes exactly one ticket plus one fee per price row.

13. **`src/__tests__/create-ticket-wizard.test.tsx`** — tests the wizard as a user would click through it: step navigation, blocking "Continue" if a checked row has no price, and the priority test QA added — using the quick-add and then canceling the wizard causes no follow-up request, proving the new registration type is never rolled back.

14. **`src/__tests__/wizard-fee-name.test.ts`** — tests the auto-generated fee name, including the truncation edge cases.

---

## Modified files

15. **`src/features/registration/components/ticket-types-workspace.tsx`**
    The Ticket Types page. The old "+ Create ticket type" button is now a split button: the primary action opens the new wizard; a small secondary menu item ("Create ticket type only — no pricing yet") still opens your original dialog, for anyone who deliberately wants the old flow. Editing an existing ticket is completely unchanged — still the original dialog.

16. **`agents/docs/BACKLOG.md`** — added the M9-T1 entry (process bookkeeping, not app code).

---

## What did NOT change

Your existing `POST .../tickets` route, `POST .../registration-types` route, and every DAL file (`adminTicketType.ts`, `adminFee.ts`, `adminRegistrationType.ts`) are byte-for-byte untouched — verified in Code Review by diffing them, not assumed. The full Pricing → Fees, Registration Types, and Ticket Types pages all still work exactly as before; the wizard is a new, additive path, not a replacement of anything underneath it.

## Verification

Independently re-run at every phase (not just trusted from agent reports): `npm run lint` clean, `npx tsc --noEmit` clean (no new errors), `npm run build` succeeds, full test suite 2197/2198 passing — the one failure is a pre-existing, unrelated hash-tripwire test on an email template file nothing here touches.
