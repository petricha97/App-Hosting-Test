// M6-T4 — shared image-URL resolution for Hero/Story (spec §3 AC-2). Runs
// the URL-scheme validator AGAIN at render time (independent of write-time
// Zod) and drops an unsafe/empty value to the block's "no image" default
// state rather than ever interpolating a raw prop string into `src=`.
import "server-only";

import { escapeHtml } from "@/lib/email/merge-tags";

import { isEmailSafeUrl } from "./url-validator";

// Returns an already-escaped, already-scheme-validated URL string safe to
// place directly inside a double-quoted `src="..."` attribute, or null when
// the value is empty/unsafe (spec §3.1 step 2: "a prop that fails scheme
// validation is dropped and the block falls back to its no-image... default
// state — never silently passes the raw string through").
export function safeImageUrl(rawValue: unknown): string | null {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (value === "" || !isEmailSafeUrl(value)) return null;
  // escapeHtml on an already-validated https?:// URL is a no-op for the
  // characters that matter here but stays cheap defense-in-depth (spec
  // §3.1 step 3) against any accidental encoding mismatch.
  return escapeHtml(value);
}
