# Security Review — M9-T1 Create Ticket Wizard

- Scope: `POST /api/dashboard/events/[eventId]/tickets/with-pricing`, `src/lib/db/adminTicketTypeWithPricing.ts`, `src/features/ticket-wizard/**`, reuse of the existing unmodified `/registration-types` POST route.
- Reviewer: Security Agent
- Date: 2026-08-24

## Verdict: PASS

No Critical/High/Medium findings. One Low/informational note (pre-existing, matches sibling routes). Ticket proceeds to QA.

## Findings

### L1. LOW / INFORMATIONAL — No rate limiting on the new route, consistent with its immediate siblings
Affected: `src/app/api/dashboard/events/[eventId]/tickets/with-pricing/route.ts` (no `checkRateLimit`).

The repo's `checkRateLimit` convention exists on export/report/email/checkin routes, but the two routes this ticket is directly modeled on — `.../tickets/route.ts` (POST) and `.../registration-types/route.ts` (POST) — also have no rate limiting. The new route matches its actual siblings; it does not introduce a new gap relative to the surface it extends. Flagged as informational only because this route is slightly more expensive per call (a transaction with up to 26 reads + up to 26 writes vs. a single write), but the 25-row cap (`MAX_TICKET_REGISTRATION_TYPES`) bounds that cost tightly, and it is gated behind session + `write:events` (authenticated org member only), not public. No remediation required to pass; consider adding `checkRateLimit` repo-wide to all three sibling create routes in a follow-up if desired.

## Verified sound (no action needed)

1. **Auth/tenancy** — `resolveRegistrationRouteScope(eventId)` (`route.ts:58`) is called identically to every sibling route: 401 no session, 403 missing `write:events` (gated on server-stamped `userDoc.permissions`, itself derived via `resolveActiveOrganizationId` roster check, not the client-writable mirror — per the M2 fix), 404 cross-org/missing event via `getAdminEventForOrganization(eventId, organizationId)`. No path bypasses this gate.
2. **IDOR — registration-type ownership** — re-verified twice: an optional outer pre-check (`findUnknownRegistrationTypeIds`, route.ts:83) and the authoritative in-transaction check (`adminTicketTypeWithPricing.ts:173-198`), which treats a missing doc and a foreign-org/foreign-event doc identically as "unknown" (`!doc || doc.eventId !== input.eventId || doc.organizationId !== input.organizationId`). An Org-A caller cannot attach Org-B's registration type to a ticket, and cannot learn whether a foreign id exists (same 400 either way).
3. **IDOR — ticket-code uniqueness** — authoritative check is a `tx.get` scoped to `eventId` inside the transaction (`adminTicketTypeWithPricing.ts:148-153`), closing the TOCTOU window the spec calls out between the optional pre-check and the write.
4. **Price precision/bounds** — `basePriceMinor: z.number().int().min(0).max(MAX_PRICE_MINOR)` (`schemas.ts:79`). `z.number().int()` rejects `NaN` and `Infinity` (`Number.isInteger` is `false` for both), so no float, NaN, or unbounded value can reach the DAL; a missing field fails Zod's required check rather than silently defaulting. No client path bypasses the bound — the DAL writes `price.basePriceMinor` straight through with no re-derivation that could reintroduce an unvalidated value.
5. **Mass assignment** — `ticketWithPricingPayloadSchema` has no `organizationId`, `registeredCount`, `registrationTypeIds`, `status`, or timestamp fields; Zod strips unknown keys. The DAL's `ticketDoc`/`feeDoc` object literals (`adminTicketTypeWithPricing.ts:216-230`, `256-271`) only ever populate the intended fields — `organizationId`/`eventId` come from the authenticated `scope`, never the body; `registrationTypeIds` is always `uniqueRegistrationTypeIds` derived from `prices`, never a body field (the schema doesn't even define one); `registeredCount: 0` and `Fee.status: "active"` are hardcoded, not client-suppliable. Verified true in code, not just asserted in the spec.
6. **Quick-add error handling** — `registration-type-quick-add.tsx` reuses `applyApiFormError`, which only ever surfaces `{error, field}` (a static "Code already in use" string) or a flattened Zod message — never echoes back another org's registration-type name/code, and a network/500 failure falls through to a generic fallback toast, not raw response detail.
7. **DoS shape / transaction cost** — `prices` is hard-capped at `MAX_TICKET_REGISTRATION_TYPES = 25` at the schema layer (enforced before the transaction opens), so the transaction's registration-type read fan-out (`Promise.all` over `uniqueRegistrationTypeIds`) and write fan-out are both bounded ≤25; no loop is keyed off unbounded client input, and the duplicate-`registrationTypeId` refine prevents inflating the read/write count via repeated ids within the cap.
8. **No secrets/PII exposure** — no new env vars, no admin-SDK usage outside `src/lib/db/`, `route.ts` never surfaces internal error detail (`catch { return 500 generic message }`).

## Relevant files
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/app/api/dashboard/events/[eventId]/tickets/with-pricing/route.ts`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/lib/db/adminTicketTypeWithPricing.ts`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/features/ticket-wizard/schemas.ts`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/features/ticket-wizard/components/registration-type-quick-add.tsx`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/features/registration/server/route-scope.ts`
- `/Users/yubeikoe/Documents/GitHub/App-Hosting-Test/src/features/registration/components/form-errors.ts`
