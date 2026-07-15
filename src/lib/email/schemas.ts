// Zod schemas + size limits for the M6-T1 email substrate — the validation
// the send service applies at enqueue and the EmailSettings DAL applies at
// write AND re-checks at send (defense in depth: a doc corrupted out-of-band
// must land `failed`, never sent with a malformed header).
// Spec: agents/docs/specs/m6-email-infrastructure.md (§4 validation, §6
// edge cases 3/4).
import "server-only";

import { z } from "zod";

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
  sortOrder: z.number().int(),
});

// z.input (pre-parse shape) — see EmailDefinitionEditablePatchInput above.
export type EmailDefinitionIfAbsentInput = z.input<
  typeof emailDefinitionIfAbsentSchema
>;
