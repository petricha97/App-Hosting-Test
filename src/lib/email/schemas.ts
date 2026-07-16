// Zod schemas + size limits for the M6-T1 email substrate — the validation
// the send service applies at enqueue and the EmailSettings DAL applies at
// write AND re-checks at send (defense in depth: a doc corrupted out-of-band
// must land `failed`, never sent with a malformed header).
// Spec: agents/docs/specs/m6-email-infrastructure.md (§4 validation, §6
// edge cases 3/4).
import "server-only";

import { z } from "zod";

import { EMAIL_SAFE_BLOCK_TYPES } from "@/types/collection";

// ---------------------------------------------------------------------------
// Header safety
// ---------------------------------------------------------------------------

// CR/LF + the rest of the C0 range and DEL — anything that could smuggle a
// header line or otherwise corrupt header-bound strings.
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;

export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS_RE, "");
}

export function hasControlChars(value: string): boolean {
  CONTROL_CHARS_RE.lastIndex = 0;
  return CONTROL_CHARS_RE.test(value);
}

// ---------------------------------------------------------------------------
// Addresses & display names (EmailSettings + recipients)
// ---------------------------------------------------------------------------

// RFC-shape mailbox address: lowercased, bounded, no control characters.
// Control characters are REJECTED (not stripped) — a stripped address is a
// different address, and silently "fixing" one would hide caller bugs.
export const emailAddressSchema = z
  .string()
  .max(254, "Email address must be 254 characters or fewer.")
  .refine((value) => !hasControlChars(value), {
    message: "Email address must not contain control characters.",
  })
  .pipe(z.email("Enter a valid email address."))
  .transform((value) => value.toLowerCase());

// Display-name header safety (spec §4): control characters stripped, and
// `"` `<` `>` rejected — those delimit the mailbox in a From: header, so a
// name containing them could forge the visible sender.
export const fromNameSchema = z
  .string()
  .transform((value) => stripControlChars(value).trim())
  .pipe(
    z
      .string()
      .min(1, "Sender name is required.")
      .max(100, "Sender name must be 100 characters or fewer.")
      .refine((value) => !/["<>]/.test(value), {
        message: 'Sender name must not contain `"`, `<` or `>`.',
      }),
  );

// Per-event sender identity (EmailSettings write shape + at-send re-check).
export const emailSenderIdentitySchema = z.object({
  fromName: fromNameSchema,
  fromAddress: emailAddressSchema,
  replyTo: emailAddressSchema.nullable(),
});

export type EmailSenderIdentityInput = z.input<
  typeof emailSenderIdentitySchema
>;
export type EmailSenderIdentity = z.output<typeof emailSenderIdentitySchema>;

// Enqueue recipient: invalid entries are TYPED enqueue rejections (caller
// errors — no outbox row is ever written for them; only transport failures
// produce `failed` rows). Name is display-only: control chars stripped,
// bounded, may be empty ("" renders as address-only).
export const emailRecipientSchema = z.object({
  name: z
    .string()
    .transform((value) => stripControlChars(value).trim())
    .pipe(
      z.string().max(200, "Recipient name must be 200 characters or fewer."),
    ),
  email: emailAddressSchema,
});

export type EmailRecipientInput = z.input<typeof emailRecipientSchema>;

// ---------------------------------------------------------------------------
// Rendered-content size limits (edge case 3 — rejected BEFORE any write)
// ---------------------------------------------------------------------------

// Firestore's 1 MiB doc limit is the hard ceiling; these keep one outbox row
// comfortably under it and header-sane. Checked against the RENDERED output.
export const EMAIL_SUBJECT_MAX_CHARS = 255;
export const EMAIL_BODY_HTML_MAX_BYTES = 256 * 1024;
export const EMAIL_BODY_TEXT_MAX_BYTES = 64 * 1024;

export type RenderedEmailContentIssue =
  "SUBJECT_TOO_LONG" | "BODY_HTML_TOO_LARGE" | "BODY_TEXT_TOO_LARGE";

// Boundary-value semantics: AT the limit passes, one over fails.
//
// Header safety at the chokepoint: control characters in the RENDERED
// subject are STRIPPED here (the sanitized content is returned on ok), so a
// CR/LF that originates in the subject TEMPLATE itself — not just in merged
// values, which the renderer already strips — can never reach storage or a
// transport. Strip (not reject) mirrors the spec's prescribed behavior for
// merged values: a subject is display-only prose, so dropping the characters
// cannot change its meaning the way "fixing" an address would (contrast
// emailAddressSchema above, which rejects). Callers MUST persist/send the
// returned `content`, not their own input.
export function validateRenderedEmailContent(content: {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}):
  | {
      ok: true;
      content: { subject: string; bodyHtml: string; bodyText: string };
    }
  | { ok: false; issues: RenderedEmailContentIssue[] } {
  const issues: RenderedEmailContentIssue[] = [];
  const subject = stripControlChars(content.subject);

  if (subject.length > EMAIL_SUBJECT_MAX_CHARS) {
    issues.push("SUBJECT_TOO_LONG");
  }
  if (Buffer.byteLength(content.bodyHtml, "utf8") > EMAIL_BODY_HTML_MAX_BYTES) {
    issues.push("BODY_HTML_TOO_LARGE");
  }
  if (Buffer.byteLength(content.bodyText, "utf8") > EMAIL_BODY_TEXT_MAX_BYTES) {
    issues.push("BODY_TEXT_TOO_LARGE");
  }

  return issues.length === 0
    ? {
        ok: true,
        content: {
          subject,
          bodyHtml: content.bodyHtml,
          bodyText: content.bodyText,
        },
      }
    : { ok: false, issues };
}

// ---------------------------------------------------------------------------
// EmailDefinition (M6-T2) — the template entity + its editable-fields
// envelope. Spec: agents/docs/specs/m6-emails-admin.md (§2).
//
// Colocated HERE (not src/features/emails/*) because EmailDefinition is
// SERVER-ONLY infrastructure with no client repo pair — the exact same
// rationale that put the T1 EmailSettings/EmailMessage schemas above in this
// file rather than a feature directory (src/features/emails/ is the
// Full-Stack Developer's slice, built on top of this DAL).
//
// `at` (the scheduled-trigger datetime) is validated as a plain `Date`, NOT
// a Firestore `Timestamp` — routes must not import firebase-admin directly
// (adminTicketType.ts SalesBoundaryInput precedent); the DAL
// (adminEmailDefinition.ts) converts Date -> Timestamp at the write boundary
// so this module never imports "firebase-admin/firestore" (import-boundary
// test: keeps Firestore access out of src/lib/email).
// ---------------------------------------------------------------------------

export const EMAIL_DEFINITION_NAME_MAX_CHARS = 120;
export const EMAIL_DEFINITION_SUBJECT_MAX_CHARS = 255;
export const EMAIL_DEFINITION_BODY_MAX_BYTES = 32 * 1024;

export const emailDefinitionGroupSchema = z.enum([
  "pre-event",
  "post-registration",
  "debt-chase",
]);

export const emailDefinitionAudienceSchema = z.enum([
  "all-invitees",
  "abandoned",
  "pending-approval",
  "accepted-paid",
  "accepted-invoice",
  "accepted-all",
]);

// Every trigger *type* the catalog can express (spec §2 table). `offsetsDays`
// / `at` only exist on their own variant — a discriminated union keeps
// "trigger type" a single comparable field for the locked-field check
// (adminEmailDefinition.ts compares `existing.trigger.type` to
// `patch.trigger.type`).
export const emailDefinitionTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("on-submit") }),
  z.object({ type: z.literal("on-accept") }),
  z.object({ type: z.literal("abandoned-24h") }),
  z.object({
    type: z.literal("unpaid-offsets"),
    offsetsDays: z
      .array(z.number().int().positive())
      .min(1, "At least one offset day is required."),
  }),
  z.object({
    type: z.literal("scheduled"),
    at: z.date().nullable(),
  }),
]);

export type EmailDefinitionTriggerInput = z.infer<
  typeof emailDefinitionTriggerSchema
>;

// OQ-1 default (spec §2): custom (isSystem:false) definitions may only use
// these trigger types in T2 — lifecycle auto-triggers stay bound to system
// kinds until T3 defines segmentation. Re-checked in the DAL (defense in
// depth), not just at this Zod boundary.
export const CUSTOM_EMAIL_DEFINITION_ALLOWED_TRIGGER_TYPES = [
  "manual",
  "scheduled",
] as const;

export const emailDefinitionNameSchema = z
  .string()
  .transform((value) => stripControlChars(value).trim())
  .pipe(
    z
      .string()
      .min(1, "Email name is required.")
      .max(
        EMAIL_DEFINITION_NAME_MAX_CHARS,
        `Email name must be ${EMAIL_DEFINITION_NAME_MAX_CHARS} characters or fewer.`,
      ),
  );

// Subject/body are TEMPLATES (may legitimately be empty while an organizer
// is drafting) — bounds only, no min(1). Contrast
// validateRenderedEmailContent above, which checks RENDERED send-time output
// and additionally strips control characters; templates are stored verbatim
// (control chars in a body are inert prose, not a header-injection vector).
export const emailDefinitionSubjectSchema = z
  .string()
  .max(
    EMAIL_DEFINITION_SUBJECT_MAX_CHARS,
    `Subject must be ${EMAIL_DEFINITION_SUBJECT_MAX_CHARS} characters or fewer.`,
  );

export const emailDefinitionBodySchema = z
  .string()
  .refine(
    (value) =>
      Buffer.byteLength(value, "utf8") <= EMAIL_DEFINITION_BODY_MAX_BYTES,
    {
      message: `Body must be ${EMAIL_DEFINITION_BODY_MAX_BYTES / 1024} KB or smaller.`,
    },
  );

// ---------------------------------------------------------------------------
// M6-T4 — email-safe Puck block schemas (spec:
// agents/docs/specs/m6-email-designer.md §1/§2/§3). Security-critical: this
// is the WRITE-TIME half of the two-control pair described in spec §3.1 step
// 2 (the render-time half lives in src/features/emails/server/blocks, which
// re-runs the URL-scheme check independently — belt-and-suspenders against
// any path that could have written a doc without going through this Zod
// boundary, e.g. a future migration script).
// ---------------------------------------------------------------------------

// URL-typed props (imageUrl on Hero/Story): explicit scheme ALLOWLIST, not a
// blocklist — only absolute http(s) survives. This is a SEPARATE control
// from escapeHtml (spec §3.1 step 2: "escaping alone does not neutralize a
// dangerous URL scheme" — escapeHtml("javascript:alert(1)") is still a live
// javascript: URL after escaping). Rejects: relative paths (no "current
// page" to resolve against in an inbox), protocol-relative "//" (would
// inherit the recipient's mail-client scheme, unpredictable/unsafe), and any
// scheme other than http/https (javascript:, data:, vbscript:, file:, ...).
// Exported so the render-time block renderers re-run the SAME check (never a
// second, drifting implementation) — this is the "shared URL-scheme
// validator" spec §3 calls for, re-exported for convenience from
// src/features/emails/server/blocks/url-validator.ts.
const EMAIL_SAFE_URL_SCHEMES = new Set(["http:", "https:"]);

export function isEmailSafeUrl(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Explicit protocol-relative rejection (belt-and-suspenders: the URL
  // constructor below already throws on "//host/path" with no base, but
  // stating the rule explicitly keeps the reason legible/testable on its
  // own, independent of URL-constructor edge-case behavior).
  if (trimmed.startsWith("//")) return false;
  let parsed: URL;
  try {
    // No base argument: a relative path ("/foo.png", "foo.png") throws
    // here — there is no "current page" to resolve against in an inbox, so
    // relative URLs are rejected by construction, not by a separate check.
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return EMAIL_SAFE_URL_SCHEMES.has(parsed.protocol);
}

export const EMAIL_BLOCK_URL_MAX_CHARS = 2048;

// Empty string is a VALID value here (spec §1: Hero/Story render their
// "no image" default state when imageUrl is absent) — every non-empty value
// must pass isEmailSafeUrl. A value that is present but unsafe is a Zod
// REJECTION at write time (spec §2 AC-2: typed 400, zero writes) — contrast
// the render-time control, which instead DROPS an unsafe value defensively
// for data that predates this schema (spec §3.1 step 2).
export const emailSafeUrlSchema = z
  .string()
  .max(
    EMAIL_BLOCK_URL_MAX_CHARS,
    `URL must be ${EMAIL_BLOCK_URL_MAX_CHARS} characters or fewer.`,
  )
  .refine((value) => value === "" || isEmailSafeUrl(value), {
    message: "URL must be an absolute http:// or https:// address.",
  });

// Free-text prop bounds. Two tiers only (no per-field bespoke limits) —
// matches the existing app convention of a small number of named size
// constants rather than one-off magic numbers per field.
export const EMAIL_BLOCK_SHORT_TEXT_MAX_CHARS = 200;
export const EMAIL_BLOCK_LONG_TEXT_MAX_CHARS = 2000;

const emailBlockShortText = (label: string) =>
  z
    .string()
    .max(
      EMAIL_BLOCK_SHORT_TEXT_MAX_CHARS,
      `${label} must be ${EMAIL_BLOCK_SHORT_TEXT_MAX_CHARS} characters or fewer.`,
    );

const emailBlockLongText = (label: string) =>
  z
    .string()
    .max(
      EMAIL_BLOCK_LONG_TEXT_MAX_CHARS,
      `${label} must be ${EMAIL_BLOCK_LONG_TEXT_MAX_CHARS} characters or fewer.`,
    );

export const EMAIL_BLOCK_ID_MAX_CHARS = 100;

export const emailBlockIdSchema = z
  .string()
  .min(1, "Block id is required.")
  .max(
    EMAIL_BLOCK_ID_MAX_CHARS,
    `Block id must be ${EMAIL_BLOCK_ID_MAX_CHARS} characters or fewer.`,
  );

// Per-type prop schemas — mirror the web block registry's prop SHAPE
// (src/features/event-pages/puck.tsx createEventPagePuckConfig) so an
// organizer's mental model carries across pages/emails (spec Shared
// decisions), but every field here is independently bounded/typed for the
// email surface — never a passthrough of the web schema.
export const emailHeroBlockPropsSchema = z.object({
  eyebrow: emailBlockShortText("Eyebrow"),
  heading: emailBlockLongText("Heading"),
  body: emailBlockLongText("Body"),
  // Preserved for round-trip storage only — NEVER rendered in email HTML
  // (spec §1 AC-3: Hero drops both CTA spans from the email render).
  primaryCtaLabel: emailBlockShortText("Primary CTA label"),
  secondaryCtaLabel: emailBlockShortText("Secondary CTA label"),
  imageUrl: emailSafeUrlSchema,
});

export const emailHighlightsBlockPropsSchema = z.object({
  title: emailBlockShortText("Title"),
  intro: emailBlockLongText("Intro"),
  itemOneTitle: emailBlockShortText("Item 1 title"),
  itemOneBody: emailBlockLongText("Item 1 body"),
  itemTwoTitle: emailBlockShortText("Item 2 title"),
  itemTwoBody: emailBlockLongText("Item 2 body"),
  itemThreeTitle: emailBlockShortText("Item 3 title"),
  itemThreeBody: emailBlockLongText("Item 3 body"),
});

export const EMAIL_STORY_IMAGE_SIDES = ["left", "right"] as const;

export const emailStoryBlockPropsSchema = z.object({
  title: emailBlockShortText("Title"),
  body: emailBlockLongText("Body"),
  imageUrl: emailSafeUrlSchema,
  // Enum, not a free string (spec §3.1 step 2) — in email this changes
  // reading ORDER only (image-first vs. text-first in the single stacked
  // column), never a two-column layout (spec §1 AC-4).
  imageSide: z.enum(EMAIL_STORY_IMAGE_SIDES),
});

export const emailScheduleBlockPropsSchema = z.object({
  title: emailBlockShortText("Title"),
  agenda: emailBlockLongText("Agenda"),
});

export const emailFaqBlockPropsSchema = z.object({
  title: emailBlockShortText("Title"),
  questionOne: emailBlockShortText("Question 1"),
  answerOne: emailBlockLongText("Answer 1"),
  questionTwo: emailBlockShortText("Question 2"),
  answerTwo: emailBlockLongText("Answer 2"),
  questionThree: emailBlockShortText("Question 3"),
  answerThree: emailBlockLongText("Answer 3"),
});

export const emailRegistrationEmbedBlockPropsSchema = z.object({
  title: emailBlockShortText("Title"),
  body: emailBlockLongText("Body"),
  buttonLabel: emailBlockShortText("Button label"),
});

export const emailTicketPricingTableBlockPropsSchema = z.object({
  title: emailBlockShortText("Title"),
  intro: emailBlockLongText("Intro"),
  emptyMessage: emailBlockShortText("Empty message"),
});

export const EMAIL_COUNTDOWN_TARGETS = ["eventStart", "custom"] as const;

export const emailCountdownTimerBlockPropsSchema = z.object({
  title: emailBlockShortText("Title"),
  // Enum, not a free string — matches the web block's radio field exactly.
  target: z.enum(EMAIL_COUNTDOWN_TARGETS),
  // Never rendered directly into HTML (only the RESOLVED absolute date is —
  // spec §1: "static send-time snapshot only") — bounded defensively, no
  // format validation needed (resolveCountdownTargetMs degrades an
  // unparseable value to the event-start fallback, then to null, never a
  // crash).
  customDateTime: z
    .string()
    .max(64, "Custom date/time must be 64 characters or fewer."),
  completedMessage: emailBlockShortText("Completed message"),
});

// Discriminated union on `type` — the WRITE-TIME half of the "Zod enum, not
// a free string" contract (spec §2). `EMAIL_SAFE_BLOCK_TYPES`
// (src/types/collection.ts) is the single source of truth for the 8-entry
// allowlist; this schema and the render-time membership re-check both
// reference it — never a second, hand-duplicated list.
export const emailPuckBlockSchema = z.discriminatedUnion("type", [
  z.object({
    id: emailBlockIdSchema,
    type: z.literal(EMAIL_SAFE_BLOCK_TYPES[0]),
    props: emailHeroBlockPropsSchema,
  }),
  z.object({
    id: emailBlockIdSchema,
    type: z.literal(EMAIL_SAFE_BLOCK_TYPES[1]),
    props: emailHighlightsBlockPropsSchema,
  }),
  z.object({
    id: emailBlockIdSchema,
    type: z.literal(EMAIL_SAFE_BLOCK_TYPES[2]),
    props: emailStoryBlockPropsSchema,
  }),
  z.object({
    id: emailBlockIdSchema,
    type: z.literal(EMAIL_SAFE_BLOCK_TYPES[3]),
    props: emailScheduleBlockPropsSchema,
  }),
  z.object({
    id: emailBlockIdSchema,
    type: z.literal(EMAIL_SAFE_BLOCK_TYPES[4]),
    props: emailFaqBlockPropsSchema,
  }),
  z.object({
    id: emailBlockIdSchema,
    type: z.literal(EMAIL_SAFE_BLOCK_TYPES[5]),
    props: emailRegistrationEmbedBlockPropsSchema,
  }),
  z.object({
    id: emailBlockIdSchema,
    type: z.literal(EMAIL_SAFE_BLOCK_TYPES[6]),
    props: emailTicketPricingTableBlockPropsSchema,
  }),
  z.object({
    id: emailBlockIdSchema,
    type: z.literal(EMAIL_SAFE_BLOCK_TYPES[7]),
    props: emailCountdownTimerBlockPropsSchema,
  }),
]);

export type EmailPuckBlockInput = z.infer<typeof emailPuckBlockSchema>;

// Two independent size/count caps (spec §2), additive to and distinct from
// the existing 32 KB `body` cap (unchanged, above) and the existing 256 KB
// rendered-`bodyHtml` cap (validateRenderedEmailContent, unchanged, still
// applies to deriveBodyHtmlFromBlocks's OUTPUT — see render.ts).
//
// EMAIL_BODY_BLOCKS_MAX_COUNT: a definition may hold at most 20 blocks —
// generous for a single email (the M4 web page builder's own starter
// templates use 3-4 blocks) while keeping the array unquestionably bounded.
//
// EMAIL_BODY_BLOCKS_MAX_BYTES = 48 KB (49152 bytes), matching spec §2's own
// recommendation exactly. Reasoning: a block stores an image URL, not image
// bytes, so realistic content (a handful of blocks, typical-length prose)
// lands far under this — e.g. a 6-block mixed design (Hero + Highlights +
// Schedule + Faq + RegistrationEmbed + CountdownTimer) with normal-length
// copy in every field serializes to roughly 3-5 KB. 48 KB comfortably fits
// even a maximal 20-block design with GENEROUS (not maxed-out) text in every
// field. It does NOT guarantee every field of every one of the 20 blocks can
// simultaneously sit at its individual per-field character maximum
// (EMAIL_BLOCK_LONG_TEXT_MAX_CHARS × 8 long-text fields on a maxed
// Highlights block alone is ~16 KB before JSON overhead) — a deliberately
// pathological "every field of every block maxed" fixture is EXPECTED to
// legitimately fail this cap, exactly mirroring spec §3 AC-4's accepted
// trade-off for the 256 KB rendered-HTML cap ("a deliberately pathological
// all-text-maxed-out fixture is allowed to legitimately fail this check").
// The cap is defense-in-depth (spec §2: "cheap... not the primary control")
// — the primary control against oversized SEND-time output remains the
// existing rendered-bytes check, which still runs on deriveBodyHtmlFromBlocks's
// output exactly as it always has on deriveBodyHtmlTemplate's.
export const EMAIL_BODY_BLOCKS_MAX_COUNT = 20;
export const EMAIL_BODY_BLOCKS_MAX_BYTES = 48 * 1024;

export const emailBodyBlocksSchema = z
  .array(emailPuckBlockSchema)
  .max(
    EMAIL_BODY_BLOCKS_MAX_COUNT,
    `A block design may contain at most ${EMAIL_BODY_BLOCKS_MAX_COUNT} blocks.`,
  )
  .refine(
    (blocks) =>
      Buffer.byteLength(JSON.stringify(blocks), "utf8") <=
      EMAIL_BODY_BLOCKS_MAX_BYTES,
    {
      message: `Block design must be ${EMAIL_BODY_BLOCKS_MAX_BYTES / 1024} KB or smaller.`,
    },
  );

export const emailBodyModeSchema = z.enum(["text", "blocks"]);

// The editable-fields envelope for BOTH materialize-on-first-edit and
// later edits (adminEmailDefinition.ts `upsertAdminEmailDefinition`'s
// `patch`). Every field is optional — callers send only what changed; the
// DAL rejects any key here that is locked for the target doc's `isSystem`
// flag (spec §2) with a typed field-errors result, not just this shape
// check.
export const emailDefinitionEditablePatchSchema = z.object({
  name: emailDefinitionNameSchema.optional(),
  group: emailDefinitionGroupSchema.optional(),
  trigger: emailDefinitionTriggerSchema.optional(),
  audience: emailDefinitionAudienceSchema.optional(),
  enabled: z.boolean().optional(),
  subject: emailDefinitionSubjectSchema.optional(),
  body: emailDefinitionBodySchema.optional(),
  // M6-T4: join the SAME editable bucket as subject/body above — editable
  // for isSystem:true AND custom definitions alike (spec §2, NOT a new
  // locked-field category; adminEmailDefinition.ts's
  // SYSTEM_LOCKED_SCALAR_FIELDS deliberately does not list either field).
  bodyMode: emailBodyModeSchema.optional(),
  bodyBlocks: emailBodyBlocksSchema.optional(),
});

// z.input (pre-parse shape) — this is what CALLERS pass to
// upsertAdminEmailDefinition's `patch`; the DAL parses it itself (defense in
// depth, same convention as upsertAdminEmailSettings).
export type EmailDefinitionEditablePatchInput = z.input<
  typeof emailDefinitionEditablePatchSchema
>;

// Full shape for creating a brand-new CUSTOM definition ("+ Create email").
// `kind` is deliberately absent — it is always server-minted
// (mintCustomEmailDefinitionKind in adminEmailDefinition.ts), never accepted
// from client input (spec §2 AC-2).
export const emailDefinitionCreateCustomSchema = z.object({
  name: emailDefinitionNameSchema,
  group: emailDefinitionGroupSchema,
  trigger: emailDefinitionTriggerSchema.refine(
    (trigger) =>
      (
        CUSTOM_EMAIL_DEFINITION_ALLOWED_TRIGGER_TYPES as readonly string[]
      ).includes(trigger.type),
    {
      message: "Custom emails may only use a Manual or Scheduled trigger.",
    },
  ),
  audience: emailDefinitionAudienceSchema,
  enabled: z.boolean().default(true),
  subject: emailDefinitionSubjectSchema,
  body: emailDefinitionBodySchema,
  // M6-T4: defaults keep every pre-T4 caller (e.g. default-definitions.ts's
  // catalog, which never mentions these fields) working unmodified — a
  // brand-new definition starts in Plain-text mode with an empty design.
  bodyMode: emailBodyModeSchema.default("text"),
  bodyBlocks: emailBodyBlocksSchema.default([]),
});

export type EmailDefinitionCreateCustomInput = z.infer<
  typeof emailDefinitionCreateCustomSchema
>;

// The full "write this if no doc exists yet" shape consumed by
// `upsertAdminEmailDefinition`'s `ifAbsent` argument. Deliberately NOT
// restricted to manual/scheduled triggers (unlike
// emailDefinitionCreateCustomSchema above) — this same shape backs BOTH:
//   (a) materializing a virtual SYSTEM default on first edit, where the
//       catalog's trigger may legitimately be on-submit/on-accept/etc., and
//   (b) creating a brand-new CUSTOM definition, where the DAL re-checks the
//       manual/scheduled restriction itself (defense in depth — see
//       CUSTOM_EMAIL_DEFINITION_ALLOWED_TRIGGER_TYPES).
export const emailDefinitionIfAbsentSchema = z.object({
  name: emailDefinitionNameSchema,
  group: emailDefinitionGroupSchema,
  trigger: emailDefinitionTriggerSchema,
  audience: emailDefinitionAudienceSchema,
  enabled: z.boolean(),
  subject: emailDefinitionSubjectSchema,
  body: emailDefinitionBodySchema,
  // M6-T4: same default rationale as emailDefinitionCreateCustomSchema above
  // — a system default materializing for the first time (or a legacy doc
  // re-supplying its unchanged ifAbsent shape) starts/stays Plain-text-mode
  // with an empty design unless a patch says otherwise.
  bodyMode: emailBodyModeSchema.default("text"),
  bodyBlocks: emailBodyBlocksSchema.default([]),
  sortOrder: z.number().int(),
});

// z.input (pre-parse shape) — see EmailDefinitionEditablePatchInput above.
export type EmailDefinitionIfAbsentInput = z.input<
  typeof emailDefinitionIfAbsentSchema
>;
