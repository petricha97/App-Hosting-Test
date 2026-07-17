# M7-T3 Data Model — Scheduled Report Delivery

Backend Agent, 2026-07-17. Implements the Backend slice of `agents/docs/specs/m7-scheduled-reports.md` (§2/§3/§4/§5/D2/D3/D4/D5) under `baseline.md` / `m6-lifecycle-triggers.md` / `m6-email-infrastructure.md` conventions. Source of truth: the spec above + `src/types/collection.ts` (`ReportScheduleDoc`) + `src/lib/db/{adminReportSchedule,reportScheduleId,reportScheduleSchemas}.ts` + `src/lib/email/lifecycle/{evaluate-report-schedules,report-schedule-periods,dedupe-keys,evaluate-event}.ts`.

**This slice ships the `ReportSchedule` entity, its DAL, the recipient-verification function, and the evaluator extension that folds report-schedule delivery into M6-T3's existing periodic sweep.** It does NOT ship the schedule create/edit UI, the `?template=` deep-link read in `report-templates-section.tsx`, or any new API routes — those are the Full-Stack Developer's parallel slice on the same ticket (confirmed already landed and wired against the exact DAL signatures below — see §7).

## 1 — Entity: `ReportSchedule`

Root collection, deterministic doc id, SERVER-ONLY (no client repo pair, `firestore.rules` deny-all — same posture as `EmailDefinition`/`EmailMessage`).

```ts
interface ReportScheduleDoc {
  organizationId: string;
  eventId: string;
  templateSlug: string;          // one of the 5 real ReportTemplateId values, checked at write time
  frequency: "daily" | "weekly" | "monthly";
  dayOfWeek: number | null;      // 0–6, JS Date convention — weekly only, else null
  dayOfMonth: number | null;     // 1–31, clamped to the month's real length at EVALUATION time — monthly only, else null
  hour: number;                  // 0–23, event-local
  minute: number;                // 0–59, event-local
  recipients: Array<{ email: string; name: string }>; // <= 20, every entry independently membership-verified
  enabled: boolean;              // pause/resume — delete is a separate hard-delete
  createdBy: string;             // creator's email, audit only, immutable after create
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}
```

**Doc id:** `reportScheduleId(organizationId, eventId, templateSlug)` = `sha256(JSON(["ReportSchedule", organizationId, eventId, templateSlug]))` (`src/lib/db/reportScheduleId.ts`) — the same tuple-hash family as `emailDefinitionId`/`emailMessageId`/`attendeeId`. **One schedule per (event, template) by construction** (spec §4 OQ-4's named YAGNI call) — "editing a schedule" is an upsert onto this same id, never a separate lookup-then-create.

**`templateSlug` is typed as a plain `string`** in `collection.ts` (not the feature-level `ReportTemplateId` union) — mirrors `EmailMessageDoc.kind`'s own "free-text join key, narrowed at the validation layer" precedent, keeping the pure types module free of a `src/features/reports` import. `src/lib/db/adminReportSchedule.ts` is the one place that checks membership in the real 5-value set (`isReportTemplateId`).

## 2 — Recipient model (spec D2) — the ticket's central security decision

**`verifyReportScheduleRecipient(email, organizationId)`** (`src/lib/db/adminReportSchedule.ts`) is the ONE function both call sites share, wrapping the already-shipped `getAdminUserMembership` (`src/lib/db/adminUserOrganization.ts`, byte-for-byte unmodified by this ticket):

```ts
async function verifyReportScheduleRecipient(
  candidateEmail: string,
  organizationId: string,
): Promise<{ email: string; name: string } | null>
```

- Lowercases/trims the candidate, calls `getAdminUserMembership` — `null` membership → `null` result (typo, ex-member, external address, or a real member of a **different** org, the two-org IDOR case spec §2 AC-2 names explicitly).
- A match resolves the **matched User doc's own `name`** via `getAdminUserByEmail` — never a client-supplied display label (spec §2 AC-1).

**Two independent call sites, per spec's explicit instruction:**

1. **Add/edit time — DEFENSE IN DEPTH, inside the DAL itself, not just the route.** `upsertAdminReportSchedule` re-verifies **every** entry in `patch.recipientEmails` (a plain `string[]` of candidate emails) before any write, **all-or-nothing** (matching `sendEventEmailBatch`'s own "invalid recipients" convention) — if any one candidate fails, the result is `{ ok:false, code:"NOT_A_MEMBER", emails:[...] }` and **zero** doc is written or updated. This is a stronger guarantee than "the route validates before calling the DAL": even a route-layer bug can never persist an unverified recipient, because the DAL will not accept one. Verification runs **outside** the Firestore transaction (unrelated `User`-collection reads); the narrow non-atomic window this leaves (a member could leave the org between this check and the write commit) is accepted because —
2. **Fire time — the actual durability guarantee (spec D2).** The evaluator (`evaluate-report-schedules.ts`) re-verifies every **stored** recipient fresh, immediately before each period's send, via plain `getAdminUserMembership` (name isn't re-fetched — the stored name is reused as-is). A departed member is **silently dropped from that send only** — no error, no mutation of the schedule's own `recipients` array. If they rejoin before a later period fires, they resume automatically.

**Cap:** `MAX_RECIPIENTS_PER_SCHEDULE = 20` (`src/lib/db/reportScheduleSchemas.ts`) — enforced by Zod (`.max(20)`) before any membership check runs, so a 21st entry is a typed `VALIDATION` rejection, never a silent truncation.

## 3 — Frequency / due-period computation (spec D3/D4)

**`resolveDueReportSchedulePeriods`** (`src/lib/email/lifecycle/report-schedule-periods.ts`) — a **pure**, Firebase-free module (safe for a future client-side "fires next on..." preview, though none is built by this ticket) reusing the exact event-local↔UTC conversion helpers T2's `trigger.at` materialization already uses (`eventLocalDateTimeToUtcMs`, `utcToEventLocalDate`, `src/features/registration/utils.ts` — zero forked date math).

```ts
function resolveDueReportSchedulePeriods(input: {
  frequency, dayOfWeek, dayOfMonth, hour, minute, timeZone,
  nowMs: number;
  notBeforeMs: number;   // schedule.createdAt, as ms — D4's "never predates the schedule" floor
  maxPeriods: number;    // MAX_CATCHUP_PERIODS = 4
}): Array<{ periodKey: string; dueMs: number }>
```

- **`periodKey`** (D3, deterministic, never separately persisted "already fired" state): daily/weekly → event-local calendar date `YYYY-MM-DD`; monthly → `YYYY-MM` (the clamped day is a fixed function of the month, so the month alone is unambiguous).
- **Monthly clamping**: `dayOfMonth: 31` fires on `min(dayOfMonth, daysInMonth(year, month))` — Feb 28 (non-leap) / Feb 29 (leap), never skipped, never rolled to March 1. Verified for both leap and non-leap fixtures (`report-schedule-periods.test.ts`).
- **Weekly**: walks back to the most recent occurrence of the configured `dayOfWeek` from "today" (event-local), then by 7-day increments for catch-up — never fires on any other day of the week regardless of when the sweep tick lands.
- **Bounded catch-up (D4):** returns **at most** `maxPeriods` entries, and **never** a period whose due-instant predates `notBeforeMs` — the loop walks backward from "today" and simply stops (`break`) once a candidate's due-instant falls before the floor, since due-instants are monotonically decreasing as the walk goes further back.
- **No pre-check/cursor query** (D4): the evaluator simply *attempts* every returned period every tick; `createAdminEmailMessageIfAbsent`'s create-if-absent semantics (unchanged, M6-T1) make an already-sent period a zero-write `duplicate` outcome — identical precedent to every M6-T3 trigger.

## 4 — Evaluator (`evaluate-report-schedules.ts`) — folded into M6-T3's sweep, not a parallel mechanism (D5)

**Confirmed, per spec D5's explicit instruction: ONE Cloud Scheduler job, ONE route, ONE secret, ONE rate limit — unchanged from M6-T3.** No new scheduling mechanism, no new internal route, no new `apphosting.yaml` entry. `evaluate-event.ts`'s existing per-event fan-out gained one more step, listing and looping the event's `ReportSchedule` docs exactly the way it already loops scheduled `EmailDefinition`s:

```ts
// evaluate-event.ts, appended after the existing abandoned/unpaid-offsets/scheduled loops
const reportSchedules = await listAdminReportSchedulesForEvent({ eventId, organizationId });
for (const schedule of reportSchedules) {
  const outcome = await evaluateReportScheduleTrigger({ organizationId, eventId, eventName, event, schedule, nowMs, transport });
  results.push({ kind: reportScheduleKind(schedule.templateSlug), definitionId: schedule.id, outcome });
}
```

`evaluateReportScheduleTrigger` (one `ReportSchedule`, mirrors `evaluateScheduledDefinitionTrigger`'s per-definition shape):

1. Resolves the report template's display name (`getReportTemplate`) — a missing template is defensive-only (the 5 templates are fixed/code-defined, spec §7: no "template deleted out from under a schedule" case can occur).
2. Computes due periods (§3 above), oldest-first (chronological send order — D4/spec §3 AC-6's "period N before period N+1").
3. Builds the fixed subject/body **once per tick** (identical for every period/recipient — no per-recipient personalization exists for this kind) via `buildReportScheduleEmailCopy` + the deep link (§5 below), then derives `bodyHtml`/`bodyText` through the **same, unmodified** `deriveBodyForDefinition` (`src/features/emails/server/render.ts`) every other periodic trigger uses — "reuses T1's render pipeline verbatim" (spec §5) is satisfied by construction; no new render code path exists.
4. For each period: **re-reads the schedule doc fresh** (`getAdminReportScheduleForEvent`) — a schedule disabled between periods stops all later periods on that same tick while earlier periods' already-enqueued sends stand (spec §3 AC-6, identical precedent to `paged-trigger-runner.ts`'s per-page `enabled` re-check). Re-verifies every **currently stored** recipient (§2 above) — silently drops departed members from just this send. Calls `sendEventEmailBatch` with `dedupeKey = reportScheduleDedupeKey(schedule.id, period.periodKey)` shared across every verified recipient in the batch.
5. **`D4`'s recipient-volume note confirmed as implemented, not just asserted**: no paging infrastructure (`runPagedLifecycleTrigger`/`queryAudiencePage`) is used here — worst case per schedule per tick is `4 periods × 20 recipients = 80` send attempts, a plain in-memory loop.

**`REPORT_SCHEDULE_KIND_PREFIX` / `reportScheduleKind(templateSlug)`** → `"scheduled-report:" + templateSlug` (spec §5 — a new free-text `kind`, `definitionId: null`, never routed through `EmailDefinition`). The Email overview report's existing `kind → name` fallback (M7-T2, unmodified) renders this raw string for free — zero code change to that template.

## 5 — Dedupe key + delivery content (spec D3/§5)

**Confirmed exactly as the Orchestrator specified**, verified against `src/lib/db/emailMessageId.ts`:

```
dedupeKey = scheduleId + ":" + periodKey        (reportScheduleDedupeKey, dedupe-keys.ts)
```

No recipient component in the string itself — `emailMessageId(organizationId, eventId, kind, recipientEmail, dedupeKey)` already hashes `recipientEmail` as its own, separate tuple element (`src/lib/db/emailMessageId.ts` line 29, confirmed by direct read before writing any code). Two recipients sharing one `dedupeKey` land on two distinct outbox docs by construction — the exact property M6-T3 §7's "Email all" already relies on (`dedupeKey: draftId` shared across a batch of *different drafts*; here, one `dedupeKey` shared across a batch of *different recipients* for the same period).

**Content (spec D1/§5):** fixed, code-defined copy — `buildReportScheduleEmailCopy` builds `subject: "Your {templateName} report is ready — {eventName}"` and a body naming the report + the deep link, **nothing else**. `buildReportScheduleDeepLink` constructs `/dashboard/events/{eventId}/reports?template={slug}`, prefixed with `NEXT_PUBLIC_APP_URL`'s resolved origin (`resolveEmailBaseUrl`, M6-T4's existing helper, unmodified) when configured; falls back to the site-relative path when unset (a deliberate, documented deviation — see §6). No row data, no attendee names/emails, no dollar amounts anywhere in the rendered body — verified by a fixture-based test scanning for a stray `$` amount pattern.

## 6 — Firestore rules / indexes

- **`firestore.rules`**: one new deny-all block, `match /ReportSchedule/{scheduleId} { allow read, write: if false; }` — same one-line addition every prior server-only entity (`EmailDefinition`, `EmailMessage`, `Order`) already required.
- **`firestore.indexes.json`: NO new index — a deliberate deviation from the spec's own gap-analysis suggestion.** The spec proposed `ReportSchedule eventId ASC, organizationId ASC`, but `listAdminReportSchedulesForEvent`'s actual query is **pure equality filters with no `orderBy`** (`.where("eventId","==").where("organizationId","==")`) — Firestore serves this from its automatic per-field indexes without a composite entry. Confirmed against this codebase's own precedent: `src/lib/db/adminCheckinTeamMember.ts`'s `eventId ==` + `accessCodeHash ==` + `isActive ==` query (three equality filters, no orderBy) has never needed one either. No `orderBy`/cursor is needed at this volume anyway (at most 5 real docs per event, spec's own point) — `firestore.indexes.json` is untouched by this ticket.

## 7 — DAL surface (exact signatures Full-Stack's routes call — confirmed already integrated)

```ts
// src/lib/db/reportScheduleId.ts
function reportScheduleId(input: { organizationId, eventId, templateSlug }): string

// src/lib/db/adminReportSchedule.ts
function getAdminReportScheduleForEvent(input: { scheduleId, eventId, organizationId }): Promise<WithId<ReportScheduleDoc> | null>
function getAdminReportScheduleByTemplate(input: { templateSlug, eventId, organizationId }): Promise<WithId<ReportScheduleDoc> | null>
function listAdminReportSchedulesForEvent(input: { eventId, organizationId }): Promise<WithId<ReportScheduleDoc>[]>
function verifyReportScheduleRecipient(candidateEmail: string, organizationId: string): Promise<{ email, name } | null>
function upsertAdminReportSchedule(input: {
  organizationId, eventId, templateSlug, createdBy,
  patch: unknown,   // raw request body minus templateSlug — Zod-parsed INSIDE this function
}): Promise<
  | { ok: true; created: boolean; schedule: WithId<ReportScheduleDoc> }
  | { ok: false; code: "VALIDATION"; issues: string[] }
  | { ok: false; code: "UNKNOWN_TEMPLATE" }
  | { ok: false; code: "NOT_A_MEMBER"; emails: string[] }
  | { ok: false; code: "NOT_FOUND" }
>
function deleteAdminReportSchedule(input: { scheduleId, eventId, organizationId }): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" }>

export { MAX_RECIPIENTS_PER_SCHEDULE, reportScheduleUpsertPatchSchema } from "./reportScheduleSchemas";
```

**Verified against actual consumer code** (`src/app/api/dashboard/events/[eventId]/reports/schedules/{route.ts,[templateSlug]/route.ts}` — Full-Stack's already-landed parallel slice): every call site matches these signatures exactly, including the `NOT_A_MEMBER`/`VALIDATION`/`UNKNOWN_TEMPLATE`/default-404 result-code branching. `npm run build` compiles the full route tree (including both schedule CRUD routes) with zero type errors — confirmed end-to-end, not just unit-tested in isolation.

**Reconciliation note:** a Full-Stack-authored provisional copy of `ReportScheduleFrequency`/`ReportScheduleRecipient`/`ReportScheduleDoc` briefly landed in `src/types/collection.ts` too (parallel-dispatch collision, explicitly flagged "for Backend review" in its own comment). Removed as a pure duplicate — identical shape, no call site referenced it, confirmed by a targeted grep before deleting.

## 8 — Query patterns and indexes (summary)

| Query | Method | Index |
|---|---|---|
| Schedule by id, tenancy-checked | `getAdminReportScheduleForEvent` | doc-id read, no query |
| Schedule by (event, template) | `getAdminReportScheduleByTemplate` | doc-id derivation (`reportScheduleId`), no query |
| All schedules for an event | `listAdminReportSchedulesForEvent` | pure equality (`eventId==`, `organizationId==`), no orderBy — **no new index** (§6) |
| Recipient membership check | `getAdminUserMembership` (unchanged, M8-baseline) | doc-id read (`User/{email}`), no query |

## 9 — Read/write access rules

- **Create/edit/pause/delete a schedule:** `write:events`, via `resolveReportsRouteScope(eventId, { requireWriteEvents: true })` — Full-Stack's routes, unchanged helper from M7-T2.
- **Be a recipient:** any current, verified org member (D2) — independent of `write:events`.
- **The internal sweep entrypoint:** unchanged M6-T3 tenancy contract — every DAL call carries both `organizationId` and `eventId`; the route remains fail-closed-shared-secret authenticated, never session-based.
- **No new collections beyond `ReportSchedule` itself**; no `EmailMessage`/`EmailDefinition` schema change (`kind`'s free-text convention absorbs the new `"scheduled-report:<slug>"` value with zero code change elsewhere).

## 10 — Tests

| File | Covers |
|---|---|
| `report-schedule-periods.test.ts` | daily/weekly/monthly due/not-due computation, event-timezone resolution, monthly clamping (leap/non-leap Feb), `MAX_CATCHUP_PERIODS` ceiling, the `notBeforeMs` floor |
| `admin-report-schedule.test.ts` | create-if-absent upsert onto the deterministic id (2nd "create" call edits, never duplicates), recipient verification (member / non-member / cross-org), all-or-nothing rejection with zero write, 21st-recipient cap rejection, frequency/day cross-field validation, get/list tenancy scoping (IDOR-safe), hard delete |
| `lifecycle-evaluate-report-schedules.test.ts` | fires once due + zero duplicates on a re-run of the same period; fire-time re-verification (3 recipients, 1 departed → sends to exactly 2, schedule's own stored list untouched); all-recipients-departed → zero mail, zero crash; disabled schedule never fires; not-yet-due; cross-org isolation; `kind`/`definitionId`/`dedupeKey` exact-match assertions; deep-link construction (absolute + relative fallback); D4 catch-up ceiling (paused 10 days → exactly 4 backfilled, not 10); D4 floor (never predates `createdAt`) |
| `lifecycle-evaluate-event-report-schedules.test.ts` | confirms the evaluator extension is actually reachable through `evaluateEventLifecycleTriggers` (the same function `run-sweep.ts`/the internal route call) alongside the pre-existing M6-T3 trigger types — zero-schedule events add zero entries, no crash |
| `lifecycle-dedupe-keys.test.ts` (extended) | `reportScheduleDedupeKey` formula, stability, non-collision across schedules/periods |

**Full-suite regression:** `npm test` — 144 files / 1660 tests passing (baseline 140/1615 + this ticket's 4 new files / 45 new tests). `npm run lint` clean. `npm run build` compiles the full route tree (including Full-Stack's schedule CRUD routes) with zero errors. `tsc --noEmit` shows only the pre-existing 3-file baseline (`attendees-roster.test.ts`, `event-org-scoping.test.ts`, `register-route.test.ts`) — zero new errors introduced.

## 11 — Deviations from the spec

- **No new `firestore.indexes.json` entry** — see §6. The spec's own gap-analysis suggestion assumed a composite index was needed; verified against Firestore's actual equality-only-query behavior and this codebase's own `adminCheckinTeamMember.ts` precedent that it is not.
- **DAL-level recipient re-verification on EVERY upsert (not just route-level)** — the spec describes add-time verification as something "the server calls" without pinning the exact layer; this implementation puts it inside `upsertAdminReportSchedule` itself (not just trusting the CRUD route to have already checked), so a future route-layer bug can never persist an unverified recipient. Strictly stronger than the spec's minimum, same direction as every other "defense in depth" call already established in this codebase (e.g. `send-service.ts`'s sender-identity re-validation at send time).
- **Deep link falls back to a site-relative path when `NEXT_PUBLIC_APP_URL` is unset**, rather than refusing to send. The spec doesn't address this case explicitly; RegistrationEmbed's own precedent (`resolve-block-context.ts`) is to degrade to "no CTA" when the base URL can't be resolved, but a scheduled-report notification's ENTIRE payload is the link — refusing to send would silently defeat the whole feature the moment an operator forgets the env var. A relative link is still useful to an organizer who already has the dashboard open in another tab, and the notification purpose (a reminder something is ready to view) survives even without a clickable absolute URL.
- **No merge-tag usage for the report name / event name / link** — the spec's own example copy (`"Your {report_name} report is ready — {event_name}"`) uses tag-like syntax for two names that are NOT in `EMAIL_MERGE_TAGS`' canonical catalog (only `event_title` exists, not `report_name`/`event_name`). Since the evaluator already has `templateName`/`eventName` in hand at build time (no per-recipient personalization exists for this kind), the subject/body are built as plain interpolated strings and THEN passed through the same `sendEventEmail`→`renderEmailTemplate` pipeline every other trigger uses — satisfying spec §5's "reusing T1's render pipeline verbatim" instruction without inventing two new catalog tags for a single call site.
