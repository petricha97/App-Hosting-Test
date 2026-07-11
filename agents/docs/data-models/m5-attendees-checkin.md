# M5 Data Model — Attendees, Check-in Config, Team Members, QR & Scanner Tokens

Backend Agent, 2026-07-11. Implements the data layer of `agents/docs/specs/m5-attendees-checkin.md` under `baseline.md` / `m1` / `m2` / `m3` conventions. Source of truth: `src/types/collection.ts` + `src/lib/db/{adminAttendee,adminCheckinConfig,adminCheckinTeamMember,attendeeId,adminFormData}.ts` + `src/lib/qr/{qr-token,scanner-session}.ts` + `src/features/responses/on-submission-accepted.ts` + `firestore.indexes.json` + `firestore.rules` + `apphosting.yaml`.

## Collections

### `Attendee` (root, **deterministic doc IDs**, SERVER-ONLY — PII + QR hashes)

Doc id = `attendeeIdFromSubmissionId(org, event, submissionId)` = `sha256(JSON(["Attendee", organizationId, eventId, submissionId]))` (`src/lib/db/attendeeId.ts`, pure — same tuple-hash family as `formDataId.ts` / `order-id.ts`, "Attendee" domain prefix keeps derivations disjoint).

```ts
interface AttendeeDoc {
  organizationId; eventId: string;
  submissionId: string;                 // the FormData doc id (1:1, id-deriving)
  orderId: string | null;               // null = legacy flat submission
  pathId: string | null;
  firstName / lastName / email / company / jobTitle: string;  // "" when the form lacked the key
                                        // (submission keys first_name/last_name/email/company/job_title, trimmed)
  registrationTypeId: string | null;    registrationTypeLabel: string;  // "—" fallback
  ticketTypeId: string | null;          ticketLabel: string;            // "—" fallback
  status: "accepted" | "cancelled";     // "accepted" initial; cancelled = model-only in M5 (no UI)
  checkInState: "not-arrived" | "checked-in";   // orthogonal to status
  checkedInAt: Timestamp | FieldValue | null;   // set ONCE, never overwritten
  checkedInBy: { kind:"admin"; userId } | { kind:"team-member"; teamMemberId; name } | null;
  qrTokenHash: string;                  // sha256 hex — raw token NEVER stored
  createdAt / updatedAt: Timestamp | FieldValue;
}
```

`checkedInBy` is the STRUCTURED union from the spec (not a bare string): `userId` = the User doc id (lowercased email) on the dashboard path; team path denormalizes `name` so the ALREADY_CHECKED_IN card renders "at 09:42 by Maria" without a join.

**Denorm sources at accept:** personal fields from the submission map; `ticketLabel` from the finalize-time `FormDataDoc.ticketLabel` denorm; `registrationTypeId`/`ticketTypeId` from the linked Order; `registrationTypeLabel` from the RegistrationType doc name. **Degradation rule (documented decision):** an `orderId` that no longer resolves, or a deleted RegistrationType, degrades to null ids / "—" labels — an accepted registrant never becomes un-checkinable because a denorm source vanished (the `orderId` reference itself is kept for audit).

### `CheckinConfig` (root, **doc id = eventId**, 1:1, SERVER-ONLY)

```ts
interface CheckinConfigDoc {
  organizationId; eventId: string;
  signatureCollection; photoCapture; photoIdVerification; selfPrintBadges; walletPasses: boolean;
  createdAt / updatedAt;
}
```

- **Lazy lifecycle:** no doc until the first PATCH. `getAdminCheckinConfigForEvent` returns `CHECKIN_CONFIG_DEFAULTS` (Off/Off/On/On/On per prototype) with ZERO writes; first `upsertAdminCheckinConfig` creates defaults+patch; later upserts merge through the **boolean allow-list** only (unknown keys and non-boolean values dropped in the DAL; org/event/createdAt unreachable). Cross-org doc → read as defaults, upsert returns null (route 404).
- Toggles are stored booleans only; enforcement of what they gate (and wallet passes themselves, Q4) lands later.

### `CheckinTeamMember` (root, auto IDs, SERVER-ONLY — credential hashes)

```ts
interface CheckinTeamMemberDoc {
  organizationId; eventId: string;
  name; deviceLabel: string;
  accessCodeHash: string;      // sha256 hex of the NORMALIZED access code — raw code NEVER stored
  isActive: boolean;           // revoke = false; doc kept for the checkedInBy audit trail
  lastSeenAt: Timestamp | null; // null = "Never used"; bumped on exchange + resolve/confirm
  createdAt / updatedAt;
}
```

Create contract: the ROUTE mints the code (`generateScannerAccessCode`), returns it once in the response body, and hands only `hashScannerAccessCode(code)` to the DAL — the raw code never reaches `src/lib/db/` or Firestore (schema-asserted in tests).

### `FormData` — M5-T1 additive field (existing collection)

```ts
qrTokenHash?: string | null;   // OPTIONAL — legacy docs parse unchanged, NO backfill on read
```

Stamped by `createAdminFormDataForDraft` (finalize) since the token is deterministic and the formDataId is derived before the write. Legacy/flat submissions lack it → the accept hook mints one and backfills it via `markAdminFormDataAttendeeCreated` (the only write path that sets it post-hoc; a finalize-stamped hash is never rewritten).

## Token schemes (three, deliberately separate)

| | Draft token (M3) | **QR token (M5-T1)** | **Scanner session (M5-T5)** |
|---|---|---|---|
| Module | `src/lib/draft-token.ts` | `src/lib/qr/qr-token.ts` | `src/lib/qr/scanner-session.ts` |
| Format | `{draftId}.{sig}` | `{eventId}.{formDataId}.{sig}` | `{teamMemberId}.{expiresAtMs}.{sig}` |
| HMAC binds | draftId + eventId | eventId + formDataId | teamMemberId + eventId + expiresAtMs |
| Lifetime | until finalize | unlimited (deterministic re-mint) | 12h (`SCANNER_SESSION_TTL_MS`) |
| Secret env | `DRAFT_TOKEN_SECRET` | `QR_TOKEN_SECRET` | `SCANNER_SESSION_SECRET` |
| Persisted form | sha256 hash | sha256 hash (FormData + Attendee) | nothing (stateless) |

All three: constant-time verify (`constantTimeStringEqual`, digest-folded — no length leak), dev-fallback with ONE-TIME warn, **fail-closed in production** (missing secret throws on first use), raw tokens in bodies/headers/sessionStorage — never URLs.

**Why three secrets (decision):** rotation blast radii differ. Rotating `QR_TOKEN_SECRET` voids every printed badge and emailed confirmation QR (expensive, deliberate); rotating `SCANNER_SESSION_SECRET` just makes door staff re-enter their access codes (cheap, do it after staff turnover). Coupling them would make the cheap rotation impossible. `apphosting.yaml` declares both new secrets (`qrTokenSecret`, `scannerSessionSecret` — create with `firebase apphosting:secrets:set <name>`); add both to `.env.local` for dev parity.

**QR verification is self-contained:** `verifyQrToken({token})` returns the EMBEDDED `{eventId, formDataId}` — the resolve route then (1) compares embedded eventId to its own → WRONG_EVENT; (2) derives the attendee id and doc-gets it; (3) constant-time compares `hashQrToken(token)` to the stored `AttendeeDoc.qrTokenHash` → mismatch = INVALID (this stored hash is the revocation seam: rotate = re-mint under a new field, out of M5 scope). Missing attendee + FormData status < accepted → NOT_ACCEPTED.

**Scanner session verification is stateless, revocation is NOT:** resolve/confirm must re-load the member (`getAdminCheckinTeamMemberForEvent`) and 401 on `isActive:false` — that read is what makes revoke immediate (T4 AC-6 / T5 AC-9).

**Access codes:** 28 chars from a 32-symbol Crockford-style alphabet = 140 bits (spec AC-5 ≥128), displayed as 7 dashed groups of 4. Lookup normalizes (uppercase, strip non-alphanumerics) before hashing, so entry format never matters. Exchange path `getAdminActiveCheckinTeamMemberByAccessCodeHash` filters `isActive == true` in the query: revoked and unknown codes are both null — no oracle.

## Accept hook (`onSubmissionAccepted`) — idempotency contract

```
transitionAdminFormDataStatus(to:"accepted")   [txn commits FIRST]
  └─ hook (fired after commit, at most once via the status machine):
       1. qrTokenHash := FormData.qrTokenHash ?? hash(mint(eventId, formDataId))   [inherit-or-mint]
       2. denorms (submission map + Order + RegistrationType reads)
       3. createAdminAttendeeIfAbsent  — deterministic id, create-if-absent txn, replay = zero writes
       4. markAdminFormDataAttendeeCreated — attendeeCreated:true (+ hash backfill for legacy docs)
```

- **Hook failure never un-accepts** (T1): the accept commit stands; `status:"accepted"` + `attendeeCreated:false` is the "hook pending" signal. Every step is idempotent, so healing = calling the exported `onSubmissionAccepted(submission)` again directly (the status machine will not re-fire it — a future repair route/job is the intended caller; none ships in M5).
- The injectable `onAccepted` seam on `transitionAdminFormDataStatus` is unchanged (tests inject; production defaults to the real hook).
- Crash between step 3 and 4 → attendee exists, flag false → re-invoke returns the existing attendee (zero writes) and completes step 4.

## Check-in idempotency contract (`checkInAdminAttendee`)

Transactional read→check→write: tenant mismatch/missing → `NOT_FOUND`; `status:"cancelled"` → `CANCELLED` (no write); **already checked-in → `{ok:true, alreadyCheckedIn:true}` carrying the ORIGINAL `checkedInAt` + `checkedInBy`, ZERO writes — the first scanner's record is never overwritten** (T5 AC-6); else one write: `checkInState`, `checkedInAt` (serverTimestamp), `checkedInBy`, `updatedAt`. Concurrent confirms serialize in the transaction: exactly one writes.

## Count strategy (decision)

`countAdminAttendeesForEvent` uses Firestore **aggregate `count()`** queries (equality filters only — served by single-field index merging). Rationale vs bounded reads: exact at any roster size, no document transfer, billed 1 read/1000 index entries, and the stat cards / "N attendees" badge need exact numbers (page-length counting is spec-prohibited, T2 AC-2). Usages: accepted total = `{status:"accepted"}`; checked-in = `{checkInState:"checked-in"}`; badges-ready = accepted total (M5 decision: ready == expected). The test fake (`fake-admin-db.ts`) now supports `.count().get()`.

## Query patterns and indexes

| Query | Method | Index |
|---|---|---|
| Roster: `eventId == org == ORDER BY createdAt DESC LIMIT 50 [cursor]` | `listAdminAttendeesForEvent` | composite #1 |
| Roster status filter: `+ status ==` | same (Firestore-side filter) | composite #2 |
| Check-in filtered list: `+ checkInState ==` | same (either/or — combined filters throw, no index for that shape) | composite #3 |
| Counts: `eventId == org == [status ==|checkInState ==] COUNT` | `countAdminAttendeesForEvent` | equality-only → auto (merge) |
| Attendee by token: deterministic id → doc get | `getAdminAttendeeBySubmissionId` / `getAdminAttendeeForEvent` | n/a (doc get) |
| Attendee by stored hash: `eventId == qrTokenHash == LIMIT 1` | `getAdminAttendeeByQrTokenHash` | equality-only → auto (merge; composite NOT registered — decision, primary resolve path is the doc get) |
| Team list: `eventId == org == ORDER BY createdAt DESC LIMIT 50` | `listAdminCheckinTeamMembersForEvent` | composite #4 |
| Code exchange: `eventId == accessCodeHash == isActive == LIMIT 1` | `getAdminActiveCheckinTeamMemberByAccessCodeHash` | equality-only → auto (merge) |
| Config get/upsert | doc id = eventId | n/a (doc get) |

Registered in `firestore.indexes.json` this change (all COLLECTION scope):

1. `Attendee`: `eventId ASC, organizationId ASC, createdAt DESC` (spec T1 AC-9)
2. `Attendee`: `eventId ASC, organizationId ASC, status ASC, createdAt DESC`
3. `Attendee`: `eventId ASC, organizationId ASC, checkInState ASC, createdAt DESC`
4. `CheckinTeamMember`: `eventId ASC, organizationId ASC, createdAt DESC` (spec T4 AC-9)

## Read/write access rules

`firestore.rules`: explicit **deny-all** matches added for `Attendee`, `CheckinConfig`, `CheckinTeamMember` (T1 AC-10). No client repo pairs exist — server-only by construction, like Order/RegistrationDraft. Scanner access is capability-based (QR token / session token), inexpressible in rules.

## Divergences / notes for fullstack

- **`createAdminFormDataForDraft` needs no new input** — it derives the formDataId and self-stamps `qrTokenHash`. The finalize route re-mints the SAME token via `mintQrToken({eventId, formDataId})` for the `qrSvg` response field (deterministic — no coordination). `qrcode` dep + `FinalizeSuccess.qrSvg` + `confirmation-step.tsx` swap are route/UI work, not DAL.
- In production, finalize/accept THROW if `QR_TOKEN_SECRET` is unset (fail-closed) — configure the secret before deploying M5.
- Roster "Pending" rows come from the EXISTING `listAdminFormDataForEvent` (status ∈ new/pending/reviewed), merged in the route with Attendee rows — no new FormData query shape, no new index.
- Manual registration reuses `placeOrder` with idempotency key `"manual:" + clientRequestId` and the finalize-equivalent create → immediate `transitionAdminFormDataStatus(to:"accepted")` (fires the real hook). No parallel insert path.
- `touchAdminCheckinTeamMemberLastSeen` is a blind update — call it ONLY after the member was verified this request (code exchange or scoped load under a valid session token).
- Session-token routes: exchange = `getAdminActiveCheckinTeamMemberByAccessCodeHash` → `mintScannerSessionToken` → touch; resolve/confirm = `verifyScannerSessionToken` → `getAdminCheckinTeamMemberForEvent` (isActive check!) → work → touch. Rate limits (10/min/IP exchange, 60/min/session resolve+confirm) are route-level, not DAL.
- ESM note: `adminFormData` ⇄ `on-submission-accepted` is an intentional import cycle (hook default + completion marker); both sides only reference the other inside function bodies — safe under live bindings, exercised by tests.
