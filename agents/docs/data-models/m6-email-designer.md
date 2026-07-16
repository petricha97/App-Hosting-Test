# M6-T4 Data Model — Email Designer Block Engine

Backend Agent, 2026-07-16. Implements the DAL/render-pipeline slice of `agents/docs/specs/m6-email-designer.md` under the M6-T2 `EmailDefinition` data model (`agents/docs/data-models/m6-emails-admin.md`) and the M6-T1 render/security invariants (`agents/docs/security/m6-emails-admin.md`, `agents/docs/security/m6-email-infrastructure.md`). **This slice ships NO UI, NO dialog wiring, and NO client-side Puck canvas config** (`src/features/emails/components/*`, `email-puck-config.tsx`, `emails-workspace.tsx`, `merge-tag-menu.tsx` are the Full-Stack Developer's slice, built in parallel on top of this DAL/render layer). It also does not modify `src/features/event-pages/puck.tsx` (the web block registry, read-only reference for prop shapes) or `src/lib/email/merge-tags.ts` (`renderEmailTemplate`/`escapeHtml` — reused verbatim, byte-for-byte unmodified, per spec §3 AC-6).

## Schema additions — `EmailDefinitionDoc` (`src/types/collection.ts`)

```ts
export const EMAIL_SAFE_BLOCK_TYPES = [
  "Hero", "Highlights", "Story", "Schedule", "Faq",
  "RegistrationEmbed", "TicketPricingTable", "CountdownTimer",
] as const; // CallToAction excluded — permanent, see spec Non-goals

export type EmailSafeBlockType = (typeof EMAIL_SAFE_BLOCK_TYPES)[number];

export interface EmailPuckBlock {
  id: string;
  type: EmailSafeBlockType;
  props: Record<string, unknown>; // per-type shape lives in the Zod schemas, not here
}

interface EmailDefinitionDoc {
  // ...unchanged M6-T2 fields (organizationId, eventId, kind, name, group,
  // trigger, audience, enabled, subject, body, isSystem, sortOrder,
  // createdAt, updatedAt)...
  bodyMode?: "text" | "blocks";      // default "text" (schema-level, not stored on legacy docs)
  bodyBlocks?: EmailPuckBlock[];     // default []; only meaningful when bodyMode === "blocks"
}
```

`bodyMode`/`bodyBlocks` are **both optional** on the TS interface — same "additive fields, all optional for migration safety, defaults applied at the read boundary, never backfilled" convention as `EventPromotionDoc`/`FormDataDoc`. A definition written before this ticket shipped has neither field in Firestore; every consumer reads `doc.bodyMode ?? "text"` / `doc.bodyBlocks ?? []` (spec §2 AC-5 — proven directly by `src/features/emails/default-definitions.ts`'s `serializeStoredDefinition`, which applies exactly this fallback).

**`subject`/`body` are untouched in shape and meaning.** They remain the fields read when `bodyMode === "text"`; switching to `"blocks"` and saving does not delete them, and switching back restores the old text-authored path (spec §2 AC-4 — verified in `admin-email-definition-body-blocks.test.ts`'s block→text→block round-trip).

`EMAIL_SAFE_BLOCK_TYPES` is declared **once**, in `src/types/collection.ts`, and referenced by both the write-time Zod discriminated union (`src/lib/email/schemas.ts`) and the render-time membership re-check (`src/features/emails/server/blocks/index.ts::isEmailSafeBlockType`) — never a second, hand-duplicated list on the server side. (The client-side canvas config under `src/features/emails/types.ts` independently re-declares the same 8 string literals for its own client-safe DTO layer — the same "server doc type vs. client-safe serialized type" duplication already established for `EmailDefinitionTrigger` vs. `SerializedEmailDefinitionTrigger`; the two lists are content-identical, verified by inspection, not import-shared, because the server allowlist must never be reachable from a client bundle.)

## Zod schemas (`src/lib/email/schemas.ts`)

### `isEmailSafeUrl` / `emailSafeUrlSchema` — the shared URL-scheme validator

```ts
function isEmailSafeUrl(value: string): boolean // http(s)://, absolute only, no "//", no other scheme
const emailSafeUrlSchema = z.string().max(2048).refine(v => v === "" || isEmailSafeUrl(v))
```

Exact allow/deny list:

| Value shape | Result | Why |
|---|---|---|
| `""` | **allowed** | the block's "no image"/"no link" default state |
| `https://…`, `http://…` (absolute) | **allowed** | the only two schemes an email client should ever dereference |
| `javascript:…` | **rejected** | live script execution |
| `data:…` | **rejected** | can smuggle inline `<script>`/HTML |
| `vbscript:…`, `file:…` | **rejected** | non-web schemes, no legitimate email use |
| `//host/path` (protocol-relative) | **rejected** | inherits the recipient's mail-client scheme — unpredictable, explicit reject via `startsWith("//")` *and* the bare `new URL()` call throwing without a base |
| `/foo.png`, `foo.png` (relative) | **rejected** | `new URL()` with no base throws — there is no "current page" to resolve against in an inbox |

This is a **separate control from `escapeHtml`**, not a substitute: `escapeHtml("javascript:alert(1)")` is still a live `javascript:` URL after escaping. Reused verbatim at render time via `src/features/emails/server/blocks/url-validator.ts` (a thin re-export — one implementation, two import sites, never a drifting second copy).

### Per-block-type prop schemas

Mirror the web registry's (`src/features/event-pages/puck.tsx`) prop *shape* per block, independently bounded for email:

| Block | Props | Notes |
|---|---|---|
| `Hero` | `eyebrow, heading, body` (text/long-text), `primaryCtaLabel, secondaryCtaLabel` (text, **stored, never rendered**), `imageUrl` (URL) | |
| `Highlights` | `title, intro` + 3×`itemNTitle/itemNBody` | |
| `Story` | `title, body, imageUrl` (URL), `imageSide: "left"\|"right"` (enum) | |
| `Schedule` | `title, agenda` (long-text) | |
| `Faq` | `title` + 3×`questionN/answerN` | |
| `RegistrationEmbed` | `title, body, buttonLabel` | `registerHref` is NOT a stored prop — resolved server-side at render time from context (see below) |
| `TicketPricingTable` | `title, intro, emptyMessage` | pricing rows are NOT stored props — injected context, spec §1 AC-9 freshness divergence |
| `CountdownTimer` | `title`, `target: "eventStart"\|"custom"` (enum), `customDateTime` (bounded, never rendered raw), `completedMessage` | |

Text tiers: `EMAIL_BLOCK_SHORT_TEXT_MAX_CHARS = 200` (titles/labels/questions), `EMAIL_BLOCK_LONG_TEXT_MAX_CHARS = 2000` (body/intro/agenda/answers). `EMAIL_BLOCK_ID_MAX_CHARS = 100`.

### `emailPuckBlockSchema` — the discriminated union

`z.discriminatedUnion("type", [...8 variants])`, one per allowlisted type, each `{ id, type: z.literal(...), props: <per-type schema> }`. An unrecognized `type` string, or a recognized type whose `props` fails its own schema, is a **write-time Zod rejection** (typed 400, zero writes — spec §2 AC-2).

### `emailBodyBlocksSchema` — count + byte caps

```ts
export const EMAIL_BODY_BLOCKS_MAX_COUNT = 20;
export const EMAIL_BODY_BLOCKS_MAX_BYTES = 48 * 1024; // 49152 bytes
```

**Reasoning for 48 KB** (matches spec §2's own "~48 KB" recommendation exactly):

- A block stores an image **URL**, not image bytes — realistic block content (a handful of blocks, normal-length prose) serializes to a few KB; a 6-block mixed design (Hero + Highlights + Schedule + Faq + RegistrationEmbed + CountdownTimer) with typical copy lands around 3-5 KB.
- 48 KB comfortably fits a **realistic** 20-block design (generous, not maxed-out, text in every field).
- It does **not** guarantee every field of every one of the 20 blocks can simultaneously sit at its individual per-field character maximum — a maxed `Highlights` block alone (`EMAIL_BLOCK_LONG_TEXT_MAX_CHARS` × 4 long-text fields + `EMAIL_BLOCK_SHORT_TEXT_MAX_CHARS` × 4 short-text fields) serializes to ~8.8 KB of raw text before JSON overhead; **6** such blocks already exceed 48 KB. A deliberately pathological "every field of every block maxed" fixture is **expected** to legitimately fail this cap — this mirrors spec §3 AC-4's identical accepted trade-off for the existing 256 KB rendered-`bodyHtml` cap ("a deliberately pathological all-text-maxed-out fixture is allowed to legitimately fail this check"). Verified in `email-block-schemas.test.ts`.
- This cap is **defense-in-depth**, not the primary control (spec §2: "cheap... not the primary control") — the primary control against oversized *send-time* output remains the existing, unmodified 256 KB `EMAIL_BODY_HTML_MAX_BYTES` check (`validateRenderedEmailContent`), which still runs on `deriveBodyHtmlFromBlocks`'s **output**. The two caps are independent and separately labeled (spec §2 AC-3): a design can fail the 48 KB *stored* cap while its rendered HTML would have stayed under 256 KB, or vice versa if the caps' relationship were ever revisited.
- Independent of, and additive to, the existing 32 KB `body` (plain-text template) cap, which is completely untouched.

`emailBodyModeSchema = z.enum(["text", "blocks"])`.

### Wiring into the three existing definition schemas

`bodyMode`/`bodyBlocks` join `emailDefinitionEditablePatchSchema` (both `.optional()`), `emailDefinitionCreateCustomSchema` and `emailDefinitionIfAbsentSchema` (both `.default("text")` / `.default([])`) — the exact same bucket `subject`/`body` already occupy. No new schema category.

## `upsertAdminEmailDefinition` (`src/lib/db/adminEmailDefinition.ts`)

**No change to the locking mechanism** — `bodyMode`/`bodyBlocks` are simply added to the field lists the create/update branches already thread through, and are **never added to `SYSTEM_LOCKED_SCALAR_FIELDS`** (`["name", "group", "audience"]`, unchanged), so they are editable for `isSystem:true` **and** custom definitions alike, by construction (spec §2: "NOT a new locked-field category"):

```ts
// create branch
bodyMode: parsedPatch.data.bodyMode ?? parsedIfAbsent.data.bodyMode,
bodyBlocks: parsedPatch.data.bodyBlocks ?? parsedIfAbsent.data.bodyBlocks,

// update branch
if (parsedPatch.data.bodyMode !== undefined) updatePatch.bodyMode = parsedPatch.data.bodyMode;
if (parsedPatch.data.bodyBlocks !== undefined) updatePatch.bodyBlocks = parsedPatch.data.bodyBlocks;
```

Verified in `admin-email-definition-body-blocks.test.ts` (new file, kept separate from `admin-email-definition.test.ts` to avoid a merge collision with parallel FS work): a `SYSTEM` definition accepts a `bodyMode`/`bodyBlocks` patch with zero `LOCKED_FIELDS` rejection, identically to a custom definition; write-time rejection of an unsafe `imageUrl` and of >20 blocks both land as `VALIDATION` with zero writes; a block→text→block round-trip preserves `bodyBlocks` byte-for-byte.

`src/features/emails/default-definitions.ts`'s `serializeStoredDefinition`/`serializeVirtualDefault` (the `EmailDefinitionDoc` → `SerializedEmailDefinition` mapping the FS dialog reads) were extended with the same `?? "text"` / `?? []` fallback so the already-built dialog code (`definition?.bodyMode ?? "text"`) is actually populated end-to-end, not left permanently undefined.

## The render pipeline — `deriveBodyHtmlFromBlocks` / `deriveBodyTextFromBlocks` (`src/features/emails/server/render.ts`)

### The 5 controls (spec §3.1), concretely, in this codebase

1. **Type allowlist check** (`isEmailSafeBlockType`, `src/features/emails/server/blocks/index.ts`) — `deriveBodyHtmlFromBlocks`/`deriveBodyTextFromBlocks` both `.filter()` the block list against `EMAIL_SAFE_BLOCK_TYPES` *before* dispatching to any renderer. A block whose type isn't in the allowlist contributes nothing — never an error, never a raw-props dump (spec §1 AC-8). Re-checked here independently of the write-time Zod schema (defense-in-depth for data that predates a registry change, e.g. a legacy stored `CallToAction` block from before it was excluded).
2. **Per-prop schema, re-run at render time** — every block renderer (`src/features/emails/server/blocks/{hero,highlights,story,schedule,faq,registration-embed,ticket-pricing-table,countdown-timer}.ts`) reads its props through `shortText`/`longText`/`escapedShortText`/`escapedLongText` (`text-utils.ts`), which coerce non-strings to `""` and re-clamp to the exact same `EMAIL_BLOCK_SHORT_TEXT_MAX_CHARS`/`EMAIL_BLOCK_LONG_TEXT_MAX_CHARS` bounds the write-time schema enforces — genuinely re-validated, not merely re-parsed-and-trusted. URL props go through `safeImageUrl` (`image-utils.ts`), which re-runs `isEmailSafeUrl` and drops (not passes through) an unsafe value. Enum props (`imageSide`, `target`) are read via a bare `===` comparison with a fixed fallback, never string-interpolated.
3. **Contextual output encoding at every interpolation site** — every free-text value is `escapeHtml`'d (imported verbatim from `src/lib/email/merge-tags.ts`, never reimplemented) immediately before interpolation; every attribute is double-quoted; every URL value is `isEmailSafeUrl`-checked *then* `escapeHtml`'d before landing in `src=`/`href=`. Enforced structurally: no block-renderer template literal concatenates a raw prop string adjacent to `=` without going through one of these helpers (spot-checked by the exhaustive XSS test suite, `email-block-renderers.test.ts`).
4. **Assembly, then the existing merge-tag pass, unmodified** — `deriveBodyHtmlFromBlocks` joins each block's HTML with `"\n"` and returns one string; that string flows into `renderEmailTemplate` **exactly as `deriveBodyHtmlTemplate`'s text-mode output already does**, with zero changes to that function (spec §3 AC-6, `merge-tags.ts` SHA-256 pinned in `email-render-blocks-pipeline.test.ts` as a tripwire). `{merge_tag}` braces embedded inside an escaped block prop survive `escapeHtml` unchanged (T1 invariant) and substitute normally — including the code-authored `{event_url}` literal `RegistrationEmbed`'s zero-paths branch writes directly into its own HTML skeleton (not organizer input, safe to leave unescaped; it is itself just another `{tag}` for the same pass to find).
5. **No `<script>`/`<iframe>`/`<object>`/`<embed>`/`<form>`/`<style>`/`on*=` by construction** — the 8 renderer functions are the *entire* set of server-only template functions; there is no default/fallback branch that renders raw props, and no free-text "style" prop exists anywhere in the registry (verified by `email-block-renderer-source-safety.test.ts`'s source-level scan: every `style="..."` interpolation in every block-renderer module resolves to `EMAIL_BLOCK_COLORS.*` only — a fixed, code-authored color table, `src/features/emails/server/blocks/styles.ts` — never a prop-derived variable).

### Contextual (non-prop) data: `EmailBlockRenderContext`

Three block types need data beyond their own stored `props` — mirrors `createEventPagePuckConfig`'s injected `pricingTickets`/`countdown`/`registrationCta` on the web builder, independently re-declared (not imported — the web config lives in a `"use client"` file this server-only module must never depend on):

```ts
// src/features/emails/server/blocks/types.ts
interface EmailBlockRenderContext {
  pricing?: PublicPricingProjection | null;              // TicketPricingTable
  registrationCta?: { state: "open"|"closed"; registerHref: string } | null; // RegistrationEmbed
  countdown?: { eventStartIso: string | null; timezone: string } | null;    // CountdownTimer
}
```

Every slice is optional/nullable end-to-end and every consuming block degrades to an honest, non-crashing fallback when its slice is absent — `RegistrationEmbed` renders its "0 paths ever configured" `{event_url}` notice, `TicketPricingTable` renders its empty-tickets message, `CountdownTimer` renders `completedMessage`. **Scope note:** wiring this context from live Firestore data (fetching the event's actual pricing projection / registration path state / event-start instant) at each of M6-T3's real call sites (preview route, test-send route, trigger paths) is Full-Stack/integration scope, not built in this slice — `renderEmailDefinitionPreview`'s new `blockContext` parameter is optional and additive precisely so those call sites can adopt it incrementally without any of them being *required* to change for block-mode text/escaping/URL-validation correctness to already hold. `TicketPricingTable`'s spec §1 AC-9 freshness-divergence property (a later snapshot renders different output than an earlier one) is proven directly against `deriveBodyHtmlFromBlocks`/the block renderer in the test suite, independent of which call site eventually supplies the snapshot.

### `renderEmailDefinitionPreview` — the one-branch change

```ts
function renderEmailDefinitionPreview(input: {
  subjectTemplate: string; bodyTemplate: string; context: EmailMergeContext;
  bodyMode?: "text" | "blocks";               // NEW, optional, defaults "text"
  bodyBlocks?: EmailPuckBlock[];              // NEW, optional
  blockContext?: EmailBlockRenderContext;     // NEW, optional
}): RenderEmailTemplateResult
```

Every M6-T3 call site (already-shipped trigger paths, test-send, preview, confirmation card) keeps compiling and behaving byte-for-byte identically without passing the three new fields — `bodyMode` defaults to `"text"`, so omitting it reproduces the pre-T4 code path exactly (`deriveBodyHtmlTemplate(bodyTemplate)` / `bodyTemplate` verbatim). When a caller does pass `bodyMode: "blocks"`, both `bodyHtml` and `bodyText` are re-derived from `bodyBlocks` instead, and `bodyTemplate` is ignored — matching the spec's own framing that the plain-text draft is preserved in storage but not read while in block mode.

### Plain-text derivation (`deriveBodyTextFromBlocks`, spec §3.3)

Walks each block's **props directly** (never the rendered HTML — the naive strip-tags approach spec explicitly rejects, since it would leave leftover `&amp;`-style entities). Each block contributes its own non-empty lines in reading order (heading/title first, then body/intro, then any Q/A pairs); blocks are joined with a blank line; a block with zero text-bearing content (an image-only `Hero`) contributes nothing — never a broken empty line. Non-text blocks degrade to a short line: `TicketPricingTable` → `"View current ticket pricing: {event_url}"` (spec's own literal copy — the `{event_url}` tag substitutes via the same merge pass); `CountdownTimer` → the identical resolved absolute-target string (or `completedMessage`) the HTML version computes.

## Read/write access rules

Unchanged from M6-T2/T1 — `bodyBlocks` lives inside the same server-only `EmailDefinition` document (deny-all `firestore.rules`, no client repo pair). No new route; the existing `PATCH .../definitions/[kind]` route (FS-owned, widened to accept the new fields) is the only write path, already gated `write:events` → 403/404-IDOR → rate-limited.

## Divergences / notes for the Full-Stack slice

- **Live-data wiring for `EmailBlockRenderContext` (pricing projection, registration-path state, event countdown target) into the preview/test-send/trigger call sites is NOT part of this slice** — see the scope note above. The render functions are fully correct and fully tested against an explicitly-constructed context; assembling that context from the DAL at each call site is FS/integration work built on top.
- **No document wrapper (`<html>`/`<head>`/dark-mode `<meta>` tags) is added by this slice** — `deriveBodyHtmlFromBlocks`, like the existing `deriveBodyHtmlTemplate`, returns a body-fragment HTML string, not a full document. Spec §6's dark-mode meta-tag requirement is QA/rendering-matrix scope and applies equally to the pre-existing text-mode path (which also has no document wrapper today) — not newly introduced or newly missing because of this ticket.
- **`src/features/event-pages/puck.tsx` is read-only reference, never imported** by `src/features/emails/server/blocks/*` — verified by `email-block-renderer-boundary.test.ts`. The email renderers are from-scratch, table-based, server-only HTML-string functions (Shared decisions: "Reusing the web render closures for email output is not an option").
