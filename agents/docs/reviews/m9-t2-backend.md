# M9-T2 backend code review

Verdict: **APPROVED**. No Blocker or Should-fix findings in the reviewed backend changes.

Reviewed independently of implementation: `adminRegistrationType.ts` default-audience addition; default-audience and ticket sales API routes; the added registration-type index; `ticket-ux-dal.test.ts` and `ticket-ux-routes.test.ts`; supporting data-model notes and existing scope/update helpers.

- Default creation uses a deterministic identity derived from organization and event, reads before creating in a transaction, and returns saved values unchanged on retries. Existing identity ownership is checked before returning data. The GENERAL collision query includes both tenant and event and has a bounded result and matching index.
- Both endpoints use the existing authenticated write-permission/event-ownership scope resolver and validate request bodies with Zod. Unknown request fields cannot reach the DAL. Firestore access stays inside the DAL.
- Pause/resume passes only `isOpen` to the existing transactionally scoped update method. The method also changes `updatedAt`, preserving quantity, dates, eligibility, identifiers and counters. Resume does not remove sales restrictions.
- Tests assert persisted fields, collision and tenant behavior, unchanged saved defaults, a simulated concurrent-create retry, real route-scope authorization, malformed input, narrow updates and error contracts. They exercise behavior rather than snapshots.

Validation: 37/37 backend focused tests passed. Focused ESLint passed for both new routes, the changed DAL file, and both new backend test files. Root owns final combined build and full-suite verification.

Limits: the concurrent transaction test uses the repository fake, not a live Firestore emulator. As documented in the data-model note, generic registration-type creation retains its existing query-then-write code uniqueness behavior; this change guarantees idempotency between calls to the new default endpoint. Index provisioning belongs to normal infrastructure deployment and was not performed in this review.
