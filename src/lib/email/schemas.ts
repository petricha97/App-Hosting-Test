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
