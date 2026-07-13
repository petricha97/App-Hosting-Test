# Baseline Data Model (M0-T3)

Backend Agent, 2026-07-09. Source of truth: `src/types/collection.ts` + the repositories in `src/lib/db/`. This is the model every later ticket (M1+ entities) extends — new collections must follow the conventions below and register their composite queries in `firestore.indexes.json` in the same change.

## Conventions (as implemented today)

- **Root collections, PascalCase singular:** `Event`, `Form`, `FormData`, `FormTemplate`, `Organization`, `PromotionTemplate`, `EventPage`, `User`. One subcollection: `Event/{eventId}/EventPromotion`.
- **DAL boundary:** only `src/lib/db/*` (and `src/lib/firebase.ts` / `src/app/lib/firestore.ts`) touch Firebase SDKs. Client repos build on `src/lib/db/base.ts` (`createCollectionApi`), server repos on `src/lib/db/adminBase.ts` (`createAdminCollectionApi`). Known legacy exception: `src/app/api/dashboard/promotions/templates/[templateId]/eligible-events/route.ts:73` queries `adminDb` directly (flagged for relocation into `adminEventPromotion.ts`). Soft exceptions tolerated today: type-only `Timestamp`/`FieldValue` imports in `src/types/` and feature schemas, and `FieldValue.serverTimestamp()` sentinel imports in ~15 API routes plus `create-event-workspace.tsx` — no queries or refs, but new code should get timestamps via DAL re-exports instead.
- **IDs:** auto-generated doc IDs everywhere except `User`, which is keyed by **lowercased email**.
- **Tenancy:** every business doc carries `organizationId: string` — except `Event`, which carries the legacy `organizationPath: string` (path-shaped string, 5 historical formats — see Event below).
- **Timestamps:** `createdAt` / `updatedAt` as `Timestamp | FieldValue`, written with `serverTimestamp()` / `FieldValue.serverTimestamp()`.
- **Validation:** admin reads are re-parsed through Zod schemas (`eventDocumentSchema`, `normalizeStoredFormDocument`, `eventPageDocumentSchema`); docs failing parse are silently dropped from list results.
- **Rules caveat:** `firebase.json` declares only `firestore.indexes` — **no `firestore.rules` file exists in this repo**. Client repos (`base.ts`) run against whatever rules are deployed out-of-band. SEC should confirm deployed rules enforce org isolation for the client-readable collections listed per-collection below.

Index legend used below: **auto** = served by Firestore's automatic single-field indexes (single `==` filter, no `orderBy`); **merge** = multiple `==` filters servable by single-field index merging; **composite** = entry in `firestore.indexes.json`.

---

## Event (root collection `Event`)

```ts
interface EventDoc {
  allowOverlap: boolean;
  capacity: number;
  description: string;
  expectedGuests: number;
  eventPagePath?: string;          // "/EventPage/{id}" pointer
  formPath: string;                // "/Form/{id}" pointer (legacy link)
  invoicePath: string;
  name: string;
  organizationPath: string;        // LEGACY tenant key — path string, 5 formats
  pageMode: "default" | "custom" | "redirect";
  redirectUrl: string;
  registrationPeriod?: Record<string, string>;
  periods: Array<Record<string, string>>;
  status: "Draft" | "Published";   // keep this casing
  timezone: string;
  createdAt / updatedAt: Timestamp | FieldValue;
}
```

- **Relationships:** parent of `EventPromotion` subcollection; referenced by `Form.eventId`, `FormData.eventId`, `EventPage.eventId`. `formPath` / `eventPagePath` are string-path pointers used as fallback lookups.
- **Tenant key smell:** `organizationPath` is matched against 5 candidates from `buildOrganizationPathCandidates` (`src/features/event/utils.ts:50`): `Organization/{id}`, `organization/{id}`, `/organization/{id}`, `organizations/{id}`, `/organizations/{id}`.

| Query | Where | Index |
|---|---|---|
| `organizationPath ==` ×5 in parallel, dedupe + in-memory sort by `updatedAt` | `src/lib/db/event.ts:31-36`, `src/lib/db/adminEvent.ts:27-32` | auto (single equality). Flag: 5 reads per list load, unbounded, client-side sort |
| `status == "Published"` (public events index) | `src/lib/db/adminEvent.ts:70` | auto. Flag: cross-org unbounded scan, in-memory sort |
| doc get by id + in-memory org check | `src/lib/db/event.ts:51`, `src/lib/db/adminEvent.ts:47`, `adminEvent.ts:86` | n/a |
| `getAll` / `findMany` exported but unused for Event lists | `src/lib/db/event.ts:15-24` | n/a — do not use without `limit()` |

- **Access:** client repo (`event.ts`) used by dashboard client components; admin repo (`adminEvent.ts`) used by API routes and server components. Status flips go through `POST /api/dashboard/events/[eventId]/status` (admin SDK).

## EventPromotion (subcollection `Event/{eventId}/EventPromotion`)

```ts
interface EventPromotionDoc {
  organizationId: string;
  templateId: string;              // -> PromotionTemplate id
  inheritFromParent: boolean;      // true = cascades from template
  name: string;
  description?: string | null;
  discountType?: string | null;
  discountValue?: number | null;
  conditions: { field: string; operator: string; value: string | number }[];
  enablePromoCode: boolean;
  promoCode?: string | null;
  createdAt / updatedAt: Timestamp | FieldValue;
}
```

- **Denormalization:** template fields (name, discount, conditions, promo code) are copied onto each event promotion; `inheritFromParent` gates cascade updates, applied in ≤500-doc batches (`adminPromotionTemplate.ts:93-107`) — correct batched-write pattern, reuse it.

| Query | Where | Index |
|---|---|---|
| subcollection `organizationId ==` | `src/lib/db/adminEventPromotion.ts:22-24` | auto (collection scope) |
| org-wide fan-out: N parallel subcollection reads over caller-supplied eventIds | `src/lib/db/adminEventPromotion.ts:75-94` | auto per query. Flag: N reads per org promotions page |
| collection-group `templateId == AND organizationId ==` | `src/lib/db/adminPromotionTemplate.ts:136-140`, `src/app/api/dashboard/promotions/templates/[templateId]/eligible-events/route.ts:73-75` | **composite (CG)** — existing |
| collection-group `templateId == AND organizationId == AND inheritFromParent == true` | `src/lib/db/adminPromotionTemplate.ts:80-85` | **composite (CG)** — existing |

- Field override in `firestore.indexes.json` also exposes `organizationId` at COLLECTION_GROUP scope (ASC/DESC), enabling future org-wide CG reads without the fan-out.
- **Access:** server-only (no client repo yet; M2-T2 plans a client `eventPromotion.ts`).

## Form (root collection `Form`)

```ts
interface FormDoc {
  eventId: string;
  organizationId: string;
  title: string;
  status: "draft" | "published";
  fields: FormFieldDoc[];          // embedded array, min 3 (mandatory first/last/email)
  templateLink?: {                 // present when created from a FormTemplate
    templateId: string;
    templateVersion: number;
    detached: boolean;
    appliedAt: Timestamp | FieldValue;
  };
  createdAt / updatedAt: Timestamp | FieldValue;
}

interface FormFieldDoc {
  id: string; key: string; label: string;
  type: "text" | "email" | "textarea";
  placeholder: string; helpText: string;
  required: boolean; isMandatory: boolean; order: number;
  origin?: "mandatory" | "template" | "event";
  sourceTemplateFieldId?: string;
  rows?: number;                   // textarea only
}
```

| Query | Where | Index |
|---|---|---|
| `eventId ==`, then **org filter in memory** (`parsed.organizationId === input.organizationId`) | `src/lib/db/adminForm.ts:43,48` and `:89` (public variant) | auto today; **composite `eventId + organizationId` added** so the filter can move into the query (R4) |
| `organizationId ==` (org forms list) | `src/lib/db/adminForm.ts:129` | auto. Flag: unbounded |
| `templateLink.templateId ==`, then **org filter in memory** | `src/lib/db/adminForm.ts:145-148` (filter at `:163-166`) | auto today; **composite `templateLink.templateId + organizationId` added** (R4) |
| fallback doc get via `formPath` pointer | `src/lib/db/adminForm.ts:53-65,103-126` | n/a |

- Client repo `src/lib/db/form.ts` is a bare factory (no custom queries).
- **Access:** form authoring is admin-SDK via dashboard API routes; public registration reads published forms server-side only (`getAdminPublishedFormForPublicEvent`).

## FormData (root collection `FormData`) — registration submissions

```ts
interface FormDataDoc {
  formId: string;
  eventId: string;
  organizationId: string;          // denormalized from form/event at submit
  submission: Record<string, string>;
  submittedAt: Timestamp | FieldValue;
}
```

| Query | Where | Index |
|---|---|---|
| `organizationId ==`, then in-memory sort by `submittedAt` desc | `src/lib/db/adminFormData.ts:20` (sort `:22-37`) | auto today; **composite `organizationId ASC + submittedAt DESC` added** so the sort (and a future `limit()`) can move into the query (R2) |
| create on public register | `src/app/api/events/[eventId]/register/route.ts` via `createAdminFormData` | n/a |

- **Access:** created server-side by the public register route; read server-side for the responses screens. Client repo `formData.ts` exists but list reads should stay server-side (cross-user PII). No per-event responses query exists yet — when M3-T4 adds one, it will need `eventId + submittedAt DESC` (register it then).

## FormTemplate (root collection `FormTemplate`)

```ts
interface FormTemplateDoc {
  organizationId: string;
  title: string;
  description: string;
  status: "active" | "archived";
  version: number;                 // bumped on edit; copied into Form.templateLink
  fields: FormFieldDoc[];
  createdAt / updatedAt: Timestamp | FieldValue;
}
```

| Query | Where | Index |
|---|---|---|
| `organizationId ==`, in-memory sort by `updatedAt` desc; `status === "active"` filtered in memory | `src/lib/db/adminFormTemplate.ts:23` (sort `:29-39`, active filter `:42-47`) | auto — justified: template counts per org stay small; revisit with `organizationId + updatedAt DESC` composite if that changes |
| doc get + org ownership check | `src/lib/db/adminFormTemplate.ts:49-60` | n/a |

## EventPage (root collection `EventPage`) — Puck page-builder documents

```ts
interface EventPageDoc {
  eventId: string;
  organizationId: string;
  title: string;
  status: "draft" | "published";
  storagePrefix: string;           // Storage path for uploaded assets
  draftContent: Record<string, unknown>;      // Puck data
  publishedContent: Record<string, unknown> | null;
  createdAt / updatedAt: Timestamp | FieldValue;
}
```

| Query | Where | Index |
|---|---|---|
| doc get via `eventPagePath` pointer, org checked in memory | `src/lib/db/adminEventPage.ts:40-58` | n/a |
| fallback `eventId ==`, then **org filter in memory** (`.find(...)`) | `src/lib/db/adminEventPage.ts:61-64` | auto today; **composite `eventId + organizationId` added** (R4) |

- Draft/publish is copy-on-publish (`publishedContent = draftContent`, `adminEventPage.ts:131-161`). Public render gate: `status === "published" && publishedContent` (`:163-187`).
- **Access:** authoring server-side; public event page reads via `getAdminPublishedEventPageForEvent` only.

## Organization (root collection `Organization`)

```ts
interface OrganizationDoc {
  name: string; description?: string; logoUrl?: string;
  slug: string;
  type: "organization" | "workspace";        // workspace = personal-email org
  status: "pending" | "verified" | "suspended";
  domain?: string; domainVerified: boolean; domainVerifiedAt?: Timestamp;
  inviteCode?: string; inviteCodeEnabled: boolean;
  inviteLinkToken?: string; inviteLinkEnabled: boolean;
  allowDomainAutoJoin: boolean;
  ownerId: string;                 // owner's email (User doc id)
  memberCount: number;             // counter via increment()
  createdAt / updatedAt: Timestamp | FieldValue;
}
```

| Query | Where | Index |
|---|---|---|
| `domain == X AND allowDomainAutoJoin == true` | `src/lib/db/organization.ts:23-32` | merge-servable; **composite `domain + allowDomainAutoJoin` added** for determinism (spec #3) |
| `inviteCode == X AND inviteCodeEnabled == true` | `src/lib/db/organization.ts:34-43` | merge-servable; **composite `inviteCode + inviteCodeEnabled` added** (spec #4) |
| doc get / snapshot subscribe | `src/lib/db/organization.ts:45-48,63-67` | n/a |
| `memberCount` increment | `src/lib/db/organization.ts:56-61`, `src/lib/db/user-organization.ts:59,148,185` | n/a |

- **Access concern:** both lookup queries run on the **client** SDK during signup/join, i.e. pre-membership users must be able to query `Organization` by domain/inviteCode. Deployed rules must scope what fields those reads expose (invite token, member data). Flag for SEC/M8-T1.

## User (root collection `User`, doc id = lowercased email)

```ts
interface UserDoc {
  uid: string;                     // Firebase Auth uid
  name: string; email: string; avatarUrl?: string;
  organizationId: string;          // ACTIVE org (denormalized)
  organizationRole: "owner" | "admin" | "member";
  organizations: OrganizationMembership[];   // embedded membership list
  emailVerified: boolean;
  status: "active" | "pending" | "suspended";
  permissions: UserPermission[];   // OWNER_PERMISSIONS | MEMBER_PERMISSIONS
  createdAt / updatedAt: Timestamp | FieldValue;
  lastLoginAt?: Timestamp;
}
```

- All access is by-id (`src/lib/db/user.ts:17-36`, `src/lib/db/adminUser.ts:8-12`) — no queries, no composite needs. Server auth resolves the session user via `adminUser` (`src/lib/auth-utils.ts`).

## UserOrganization (membership) — NOT a collection

There is no `UserOrganization` collection. Membership is **embedded** as `UserDoc.organizations: OrganizationMembership[]`:

```ts
interface OrganizationMembership {
  organizationId: string;
  role: "owner" | "admin" | "member";
  joinedAt: Timestamp | FieldValue;
  joinMethod: "created" | "invite_link" | "invite_code" | "domain_auto_join";
}
```

- Written by the signup/join flows in `src/lib/db/user-organization.ts` (`signupJoinOrg:28`, `signupCreateOrgAndUser:66`, `addExistingUserToOrg:129`, `createNewUserAndJoinOrg:155`). Each flow pairs a `User` write with an `Organization.memberCount` increment — **two non-atomic writes** (see R7).
- Consequence: "list members of an org" requires an `array-contains`-style query or a real membership collection. M8-T1 (real IAM) should introduce a root `UserOrganization`/membership collection; register its indexes then.

## PromotionTemplate (root collection `PromotionTemplate`)

```ts
interface PromotionTemplateDoc {
  organizationId: string;
  name: string;
  description?: string | null;
  discountType?: string | null;
  discountValue?: number | null;
  conditions: { field: string; operator: string; value: string | number }[];
  enablePromoCode: boolean;        // true => code required to claim
  promoCode?: string | null;
  isArchived?: boolean;            // soft delete
  createdAt / updatedAt: Timestamp | FieldValue;
}
```

| Query | Where | Index |
|---|---|---|
| `organizationId ==`, in-memory `!isArchived` filter + sort by `updatedAt` desc | `src/lib/db/adminPromotionTemplate.ts:34-37` (filter/sort `:39-55`) | auto — justified while template counts are small; `organizationId + isArchived + updatedAt DESC` composite if promoted to a query |
| doc get + org ownership check | `src/lib/db/adminPromotionTemplate.ts:189-200` | n/a |

- Client repo `promotionTemplate.ts` is a bare factory; org-scoped reads happen server-side.

## Declared types without collections in active use

`InvitationDoc`, `DomainVerificationDoc` (`src/types/collection.ts:85-117`) have no DAL — reserved for M8-T1. `TodoDoc` (`:156`) is starter cruft deleted by M0-T2.

---

## Index coverage after this change (`firestore.indexes.json`)

Composite indexes now defined:

| # | Collection | Scope | Fields | Serves |
|---|---|---|---|---|
| 1 | `EventPage` | COLLECTION | `eventId ASC, organizationId ASC` | adminEventPage.ts:61 once org filter moves into the query (R4) |
| 2 | `EventPromotion` | COLLECTION_GROUP | `templateId ASC, organizationId ASC` | adminPromotionTemplate.ts:136, eligible-events route:73 (existing) |
| 3 | `EventPromotion` | COLLECTION_GROUP | `templateId ASC, organizationId ASC, inheritFromParent ASC` | adminPromotionTemplate.ts:80 (existing) |
| 4 | `Form` | COLLECTION | `eventId ASC, organizationId ASC` | adminForm.ts:43/89 once org filter moves into the query (R4) |
| 5 | `Form` | COLLECTION | `templateLink.templateId ASC, organizationId ASC` | adminForm.ts:145 once org filter moves into the query (R4) |
| 6 | `FormData` | COLLECTION | `organizationId ASC, submittedAt DESC` | adminFormData.ts:20 once sort moves into the query (R2) |
| 7 | `Organization` | COLLECTION | `domain ASC, allowDomainAutoJoin ASC` | organization.ts:23 |
| 8 | `Organization` | COLLECTION | `inviteCode ASC, inviteCodeEnabled ASC` | organization.ts:34 |

Plus the existing `EventPromotion.organizationId` field override (COLLECTION + COLLECTION_GROUP, ASC/DESC).

Everything else in the query tables above is a single-equality filter served by automatic single-field indexes — no missing-index errors are possible for the current code. Indexes 1, 4, 5, 6 are deliberately deployed **ahead** of the query changes they enable (indexes must exist before the query change ships, and equality-only composites also serve today's equality-only queries harmlessly).

## Recommendations (query-code changes NOT made here — file as follow-up tickets)

Ordered by impact. None of these were applied because M0-T3 scope excludes `src/lib/db/*.ts` edits while FS work is in flight.

1. **R1 — Cross-org Published scan** (`adminEvent.ts:70`, `getAdminPublishedEvents`): reads every Published event across all tenants, unbounded, then sorts in memory. Any public-index page load scales with global event count. Change to `where("status","==","Published").orderBy("updatedAt","desc").limit(n)` with cursor pagination (needs a `status + updatedAt DESC` composite — register when the query changes) and decide whether the public index should be org-scoped at all.
2. **R2 — Unbounded reads / no pagination anywhere:** no repository method uses `limit()` or cursors. Worst offenders: `getAdminFormDataForOrganization` (`adminFormData.ts:20` — grows with every registration; index #6 is ready, move the sort into `orderBy("submittedAt","desc")` and add `limit` + cursor), `getAdminFormsForOrganization` (`adminForm.ts:129`), R1 above, and the exported `getAll` on every base factory (`base.ts:62`, `adminBase.ts:35`). Proposed policy: every list read takes `limit` (default 50) + cursor; `getAll` removed from factory exports or renamed `unsafeGetAll`.
3. **R3 — 5-way legacy org-path fan-out** (`event.ts:31`, `adminEvent.ts:27`, `buildOrganizationPathCandidates` in `src/features/event/utils.ts:50`): every events-list load issues 5 parallel queries then dedupes/sorts in memory. Migrate: backfill a canonical `organizationId: string` field on all Event docs (one-off script), query `where("organizationId","==",id).orderBy("updatedAt","desc")` (register `organizationId + updatedAt DESC` composite with that change), keep `organizationPath` write-compat until callers migrate.
4. **R4 — In-memory org filtering** (`adminForm.ts:48` via `getAdminFormForEvent`, `adminForm.ts:163-166` via `getAdminLinkedFormsForTemplate`, `adminEventPage.ts:61-64`): tenant isolation currently depends on post-read filtering — over-reads other orgs' docs and burns quota. Move `organizationId` into the `where()`; composites #1/#4/#5 are already deployed so this is a pure code change with no index wait.
5. **R5 — Org-wide promotion fan-out** (`adminEventPromotion.ts:75-94`): N parallel subcollection reads per org promotions page. The `organizationId` COLLECTION_GROUP field override already permits a single `collectionGroup("EventPromotion").where("organizationId","==",id)` query; the parent eventId is recoverable from `doc.ref.parent.parent.id`.
6. **R6 — Direct adminDb query outside the DAL** (`eligible-events/route.ts:73-75`): move this collection-group query into `adminEventPromotion.ts` to keep the DAL boundary clean.
7. **R7 — Non-atomic signup writes** (`user-organization.ts`: User `setDoc`/`updateDoc` + Organization `memberCount` increment as separate awaits): a failure between the two leaves the counter or membership inconsistent. Use a client `writeBatch` (or move signup finalization server-side under M8-T1).
8. **R8 — No `firestore.rules` in repo:** rules are managed out-of-band, so client-SDK access (Organization lookups pre-auth-membership, `event.ts`, `form.ts`, `formData.ts` client factories) cannot be reviewed or CI-tested here. Add `firestore.rules` + `"rules"` entry in `firebase.json`; SEC to own with M8-T1 multi-tenant review. Related: client `formData.ts`/`form.ts` factories expose broad write methods the UI does not need — trim exports when rules land.
