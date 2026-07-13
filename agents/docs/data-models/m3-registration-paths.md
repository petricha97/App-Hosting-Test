# M3 Data Model — Registration Paths, Drafts, Response Status

Backend Agent, 2026-07-10. Implements the data layer of `agents/docs/specs/m3-registration-paths.md` under `baseline.md` / `m1-registration-spine.md` / `m2-pricing-commerce.md` conventions. Source of truth: `src/types/collection.ts` + `src/lib/db/{adminRegistrationPath,adminRegistrationDraft,adminFormData,formDataStatus,formDataId}.ts` + `src/lib/draft-token.ts` + `firestore.indexes.json` + `firestore.rules`.

## Collections

### `RegistrationPath` (root, auto IDs, SERVER-ONLY)

```ts
interface RegistrationPathDoc {
  organizationId: string;
  eventId: string;
  name: string;                              // 1–120 free text (route Zod)
  code: string;                              // M1 code rules, UPPERCASE, unique per event WITHIN RegistrationPath
  audienceRegistrationTypeId: string | null; // null = "Any" — stored EXPLICITLY as null (equality reference-queries)
  paymentMethod: "card" | "invoice" | "comp" | "none";  // same union as OrderDoc
  currency: Currency;                        // path pins the checkout currency (one audience × two currencies = two paths)
  isActive: boolean;                         // default true; inactive = hidden from public picker, still in admin table
  sortOrder: number;                         // int >= 0, default max+1; drives admin table AND public picker order
  createdAt / updatedAt: Timestamp | FieldValue;
}
```

- **At finalize, `paymentMethod` and `currency` are read from this doc — never from the client** (T3 AC-6). Client-supplied method/currency must be stripped by the route Zod.
- Audience → order regType resolution (fixed rule): audience set → it IS the order's `registrationTypeId`; Any → derived from the selected ticket's `registrationTypeIds` (exactly one → that one; multiple/empty → registrant picks in step 2).
- **Delete: BLOCK, never cascade** — 409 "Deactivate instead" when any `RegistrationDraft` or `FormData` references the path (`getAdminRegistrationDraftsReferencingPath` / `getAdminFormDataReferencingPath`, both bounded limit 5).

### `RegistrationDraft` (root, **server-minted IDs**, SERVER-ONLY — PII)

```ts
interface RegistrationDraftDoc {
  organizationId; eventId; pathId; formId: string;
  draftTokenHash: string;          // SHA-256 hex of the signed token — RAW TOKEN NEVER STORED
  lastStepReached: "personal_info" | "ticket_options" | "summary" | "payment";
  stepAnswers: Record<string,string>;  // validated step-1 answers (resume + finalize)
  ticketTypeId: string | null;
  registrationTypeId: string | null;
  promotionId: string | null;      // resolved id ONLY — promo code TEXT never stored
  attempt: number;                 // finalize attempt counter, starts 1, ++ ONLY after PAYMENT_FAILED
  firstName / lastName / email: string;  // "" until entered — denorms for the abandoned surface
  createdAt / updatedAt: Timestamp | FieldValue;
}
```

- Doc ID minted by `generateDraftId()` (128-bit hex) BEFORE the write, because the signed token + hash must exist at create time. `.create()` (not set) fails loudly on collision.
- **PII minimization (Q3 locked, schema-asserted in tests):** the doc contains EXACTLY the fields above — no payment data of any kind, no promo text, no IP/user-agent.
- **Abandoned = derived, never stored:** `now - updatedAt > ABANDONED_AFTER_MS` (24h; exported ONLY from `adminRegistrationDraft.ts` — M5-T3/M6-T3 import it, never copy). Existence = incomplete (completed drafts are deleted at finalize). Boundary is strict `>`: exactly 24h old is NOT yet abandoned.
- No TTL/auto-delete in M3 (retention = M6-T3/M8). Manual purge = admin delete route over `getAdminRegistrationDraftForEvent` (org-scoped, 404 cross-org) + `deleteAdminRegistrationDraft`.

### `FormData` — M3-T4 additive fields (existing collection, still SERVER-ONLY)

```ts
// ALL optional — legacy docs parse unchanged, read-time defaults, NO backfill:
status?: "new" | "pending" | "reviewed" | "accepted";
orderId?: string | null;        // populated by T3 finalize; null for flat legacy submits
pathId?: string | null;
ticketLabel?: string | null;    // denormalized at finalize from the order's fee/ticket snapshot (cheap list rendering)
statusUpdatedAt?: Timestamp | FieldValue | null;  // bumped on every transition
acceptedAt?: Timestamp | FieldValue | null;       // stamped exactly once, on accept
attendeeCreated?: boolean;      // false until M5-T1 flips it
```

Read defaults via `applyFormDataReadDefaults` / `readFormDataStatus` (`src/lib/db/formDataStatus.ts`, pure + client-safe): missing/malformed status → `"new"`, missing refs → null, `attendeeCreated` → false.

## Signed draft token scheme (`src/lib/draft-token.ts`, pure)

```
token = "{draftId}.{base64url(HMAC-SHA256(secret, draftId + "." + eventId))}"
```

- Secret from env `DRAFT_TOKEN_SECRET` (App Hosting secret in `apphosting.yaml` — fullstack must add it); missing env falls back to a built-in dev secret with a ONE-TIME `console.warn`. Explicit-secret param exists as a test seam only.
- The token is the **sole capability** for draft read/update/finalize (no session). HMAC binds draftId+eventId, so a token can never touch another event's draft.
- Verification (`verifyDraftToken`) is constant-time (both compare sides folded through SHA-256 before `timingSafeEqual` — no length leak). Invalid/forged/malformed → `{valid:false}` → routes 404, indistinguishable from missing.
- **Storage: only `hashDraftToken(token)` (SHA-256 hex) is persisted.** DAL read path `getAdminRegistrationDraftByIdAndTokenHash` re-checks eventId + stored hash (constant-time) — a bare draftId grants nothing.
- Token transport: response body at create → registrant sessionStorage → request bodies/headers. **Never in URLs.**

## Response status machine (`formDataStatus.ts` + `transitionAdminFormDataStatus`)

```
new  <  pending  <  reviewed  <  accepted(terminal)
```

- Forward-only, **skipping allowed** (new → accepted OK); backward and same-status moves → `INVALID_TRANSITION` (route 409); no "rejected" in M3 (M5 gap, documented).
- Transition runs in a transaction: read + tenant check (cross-org/event → `NOT_FOUND`, IDOR-safe) → machine check against the READ-DEFAULTED current status (legacy docs transition from "new") → write `status` + `statusUpdatedAt` (+ `acceptedAt` iff accepting). Failure = empty write set.
- **Accept hook at most once:** after commit, accept calls `onSubmissionAccepted` (no-op logging stub, `src/features/responses/on-submission-accepted.ts`; injectable `onAccepted` param for tests; M5-T1 replaces with attendee creation). Re-accept fails the machine check before the hook is reachable — double-click safe.

## Crash-recovery / idempotency flow (finalize)

```
draft (attempt N) ──▶ placeOrder(idempotencyKey = "reg:"+draftId+":"+N)   [M2 finalize txn — idempotent replay]
        │ ok
        ├─▶ createAdminFormDataForDraft   — doc id = formDataIdFromDraftId(org, event, draftId)
        │      create-if-absent txn: replay returns existing doc, created:false, ZERO writes
        ├─▶ deleteAdminRegistrationDraft  — ONLY after Order AND FormData both exist
        └─▶ respond { registrationRef, orderRef }
PAYMENT_FAILED ──▶ incrementAdminRegistrationDraftAttempt (fresh key for the retry; double-clicks still collide on the old key)
```

Crash between order and FormData → retry replays `placeOrder` (same key → existing order, no counter moves) and the FormData create lands on the same deterministic id → healed. Crash between FormData and draft-delete → retry heals the same way and re-runs the delete. `formDataIdFromDraftId` (`src/lib/db/formDataId.ts`, pure) = `sha256(JSON(["FormData", org, event, draftId]))` — tenant-namespaced like order-id.ts, `"FormData"` prefix keeps it disjoint from Order ids.

## Delete-block matrix (M3 update)

| Deleting | Blocked by (409, bounded reference queries) |
|---|---|
| RegistrationType | TicketTypes referencing it (M1) · Fees pinning it (M2) · **RegistrationPaths whose audience pins it (M3, `getAdminRegistrationPathsReferencingRegistrationType`, route wired + tested)** · registeredCount > 0 |
| TicketType | Fees pricing it (M2) · registeredCount > 0 (M1) |
| Fee | Orders referencing it (M2) → Archive |
| Tax | Orders whose taxIds contain it (M2) → deactivate |
| **RegistrationPath (NEW)** | **any RegistrationDraft on the path (limit 5) · any FormData with the pathId (limit 5) → "Deactivate instead"** |
| RegistrationDraft | nothing — manual purge always allowed (write:events) |

"Any"-audience paths never block a regType delete; "All types" fees never block one either (same principle).

## Query patterns and indexes

| Query | Method | Index |
|---|---|---|
| Paths list: `eventId == org == ORDER BY sortOrder ASC LIMIT 50` | `getAdminRegistrationPathsForEvent` (+ in-memory isActive filter for the public picker — tiny per-event counts, no extra composite, same convention as active taxes) | composite #1 |
| Path code uniqueness: `eventId == code == LIMIT 2` | `isAdminRegistrationPathCodeTaken` | composite #2 |
| Paths pinning a regType: `eventId == org == audienceRegistrationTypeId == LIMIT 20` | `getAdminRegistrationPathsReferencingRegistrationType` | equality-only → auto (merge) |
| Drafts staleness/abandoned: `eventId == org == ORDER BY updatedAt DESC LIMIT 50` | `getAdminRegistrationDraftsForEvent` (isAbandoned derived per item, nowMs injectable) | composite #3 |
| Drafts referencing a path: `eventId == org == pathId == LIMIT 5` | `getAdminRegistrationDraftsReferencingPath` | equality-only → auto (merge) |
| Draft by id+token hash / org-scoped get | `getAdminRegistrationDraftByIdAndTokenHash` / `getAdminRegistrationDraftForEvent` | n/a (doc gets) |
| Per-event responses: `eventId == org == [status ==] ORDER BY submittedAt DESC LIMIT 50 [startAfter cursor]` | `listAdminFormDataForEvent` | composites #4 (no status) / #5 (status) |
| Workspace responses: `org == [status ==] ORDER BY submittedAt DESC LIMIT 50 [cursor]` | `listAdminFormDataForOrganization` | baseline org+submittedAt (no status) / composite #6 (status) |
| Submissions referencing a path: `eventId == org == pathId == LIMIT 5` | `getAdminFormDataReferencingPath` | equality-only → auto (merge) |
| Response scoped get | `getAdminFormDataForEvent` | n/a (doc get) |
| FormData by draft | `formDataIdFromDraftId` → doc get | n/a |

Registered in `firestore.indexes.json` this change (all COLLECTION scope):

1. `RegistrationPath`: `eventId ASC, organizationId ASC, sortOrder ASC`
2. `RegistrationPath`: `eventId ASC, code ASC`
3. `RegistrationDraft`: `eventId ASC, organizationId ASC, updatedAt DESC`
4. `FormData`: `eventId ASC, organizationId ASC, submittedAt DESC`
5. `FormData`: `eventId ASC, organizationId ASC, status ASC, submittedAt DESC`
6. `FormData`: `organizationId ASC, status ASC, submittedAt DESC`

## Read/write access rules

`firestore.rules`: explicit **deny-all** matches for `RegistrationPath` and `RegistrationDraft` (commented). Paths render server-side for both the admin table and the public (possibly signed-out) picker; drafts carry PII + token hashes and are capability-gated (rules cannot express token possession). **No client repos exist for either collection — server-only by construction**, like Order.

## Divergences / notes for reviewers and fullstack

- **Status filter vs legacy docs (documented divergence):** filtering `status == "new"` in Firestore only matches docs physically carrying the field; legacy pre-M3 docs (no field) appear under "Any" and READ as "New" via the defaults. No backfill by decision; if product wants exact filter parity, backfill is a one-off script, not a read-path change.
- File is `adminRegistrationDraft.ts` (matches the spec's collection name `RegistrationDraft` and the admin-<Collection> convention), not "adminDraftRegistration".
- `getAdminNextRegistrationPathSortOrder` computes max+1 from the bounded sortOrder-asc list (no reverse-order composite needed).
- Legacy `getAdminFormDataForOrganization` (unbounded + in-memory sort) kept for existing callers; new surfaces must use the bounded `listAdminFormData*` pair.
- Fullstack wiring TODOs: `DRAFT_TOKEN_SECRET` in `apphosting.yaml` (as a secret) and `.env.local`; routes must pass tokens in bodies/headers only; the finalize route composes placeOrder → `createAdminFormDataForDraft` → `deleteAdminRegistrationDraft` in that exact order and calls `incrementAdminRegistrationDraftAttempt` only on `PAYMENT_FAILED`.
