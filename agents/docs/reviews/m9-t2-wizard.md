# M9-T2 — Independent ticket wizard review

Reviewer: Backend agent acting under `.claude/agents/code-reviewer.md`. The reviewer did not author the wizard and made no application-code changes during this review.

Scope: `src/features/ticket-wizard/schemas.ts`, all six wizard components, `src/features/registration/generate-code.ts`, `create-ticket-wizard.test.tsx` and `ticket-wizard-schemas.test.ts`, against `agents/docs/specs/m9-t2-ticket-ux.md`. The wizard developer confirmed the final reopen-cache and duplicate-publication changes were saved before approval.

## Findings

No open Blocker or Should-fix findings.

The reviewed implementation satisfies the client-side contracts:

- Details retain quantity, scheduling and manual-code state across back/forward navigation. Scheduled dates are validated as real calendar dates and ordered; disabled scheduling is omitted from both the publication summary and payload. Name-derived identifiers remain bounded and valid for accented, non-Latin, short and empty names. Manual editing stops generation.
- Audience selection requires at least one included audience with a valid price and respects the 25-row maximum. Free tickets require an explicit valid zero. Inline creation retains its entered price, reports code/capacity errors in advanced settings, and blocks navigation/closing while saving. Open unsaved mini-forms prevent advancing.
- Empty-event General attendee starts as local state and causes no opening-time write. Explicit Continue resolves it through the scoped endpoint and substitutes the real saved ID, name, code and capacity. Failure preserves the price for retry. An excluded default is not created when a custom audience is selected.
- Immediate-save continuity is preserved by the event-scoped pending-audience cache at `src/features/ticket-wizard/components/create-ticket-wizard.tsx:120`. Newly saved types remain selectable on immediate reopen with stale parent props. The cache yields to server values once acknowledged (`:153`), triggers a parent refresh (`:163`), and resets ticket prices/selection for a new ticket (`:174`). Regression tests cover both inline types and resolved defaults.
- Publication uses the same details builder as review, sends `isOpen: true`, and preserves the existing USD/minor-unit fee contract. Code collisions reveal advanced settings on step one; audience errors return to step two. The synchronous publication guard prevents duplicate requests and unlocks after failures. Server-side membership and availability checks remain authoritative.
- No Firestore SDK imports or unjustified `any` were found in the reviewed feature files. Components reuse the application's form/dialog controls and theme tokens; final browser visual QA is a separate gate.

## Verification

- Independently ran `npx vitest run src/__tests__/create-ticket-wizard.test.tsx src/__tests__/ticket-wizard-schemas.test.ts --silent`: **31/31 passed** across 2 files (17 interaction tests, 14 schema/generation cases).
- Independently ran `npx eslint src/features/ticket-wizard src/features/registration/generate-code.ts src/__tests__/create-ticket-wizard.test.tsx src/__tests__/ticket-wizard-schemas.test.ts`: **passed**.
- No full build or full suite was run as part of this review. Root owns the combined final gates and reporting of existing unrelated type errors.

**Verdict: APPROVED.** Ready for the final combined Security/QA gates.
