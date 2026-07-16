// M6-T4 — free-text prop controls for the email-safe block renderers (spec
// §3.1 steps 2/3). Every text-bearing prop in every block renderer MUST go
// through one of the `escaped*` helpers below before interpolation — never
// a raw template-literal concatenation of a prop value.
import "server-only";

import { escapeHtml } from "@/lib/email/merge-tags";
import {
  EMAIL_BLOCK_LONG_TEXT_MAX_CHARS,
  EMAIL_BLOCK_SHORT_TEXT_MAX_CHARS,
} from "@/lib/email/schemas";

// Render-time re-validation for free-text props (spec §3.1 step 2: "re-run
// at render time, not just at write time... belt-and-suspenders against any
// path that could have written a doc without going through the write-time
// schema"). Coerces a non-string to "" (never throws on a malformed stored
// type) and re-applies the SAME per-tier character bound the write-time Zod
// schema enforces, so a value that predates this schema (or was corrupted
// out-of-band) can never blow past its tier even though it already sits in
// Firestore un-reparsed.
function boundedText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

export function shortText(value: unknown): string {
  return boundedText(value, EMAIL_BLOCK_SHORT_TEXT_MAX_CHARS);
}

export function longText(value: unknown): string {
  return boundedText(value, EMAIL_BLOCK_LONG_TEXT_MAX_CHARS);
}

// Contextual output encoding (spec §3.1 step 3): escapeHtml — the EXACT
// function src/lib/email/merge-tags.ts exports and T1/T2 already rely on,
// NEVER reimplemented here — runs immediately before interpolation, after
// the defensive bound above. `{merge_tag}` braces survive escapeHtml by
// construction (an established T1 invariant: lowercase letters/digits/
// underscore/braces are outside its replacement set), so a tag embedded
// inside block prop text keeps working exactly like plain-text mode.
export function escapedShortText(value: unknown): string {
  return escapeHtml(shortText(value));
}

export function escapedLongText(value: unknown): string {
  return escapeHtml(longText(value));
}

// Schedule's `agenda` (and any future multi-line field) needs REAL line
// breaks in email — there is no CSS `white-space: pre-line` Outlook honors
// reliably, so newlines are converted to literal `<br>` tags AFTER escaping
// (escaping first means an organizer-typed literal "<br>" in their agenda
// text renders as visible text, never a real tag — only newlines this
// function itself inserts become markup).
export function escapedLongTextWithLineBreaks(value: unknown): string {
  return escapedLongText(value).replace(/\r\n|\r|\n/g, "<br>");
}
