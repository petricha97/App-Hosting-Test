// M6-T4 — the shared URL-scheme validator (spec §3.1 step 2). ONE
// implementation, reused at BOTH write time (the Zod boundary,
// src/lib/email/schemas.ts) and render time (every block renderer in this
// directory) — never a second, drifting implementation. The concrete logic
// lives in src/lib/email/schemas.ts (the module Zod already needs it in, and
// the module every write-time caller already imports from); this file
// re-exports it for a short, same-directory import path from the block
// renderers, mirroring how escapeHtml is imported directly from
// src/lib/email/merge-tags.ts rather than reimplemented here.
//
// This is a SEPARATE control from escapeHtml, not a substitute for it:
// escapeHtml("javascript:alert(1)") is still a live javascript: URL after
// escaping — escaping only protects against breaking OUT of an attribute,
// never against the browser/mail-client interpreting the scheme a URL
// names. Only an absolute http:// or https:// URL passes; relative paths,
// protocol-relative ("//host/path"), and every other scheme (javascript:,
// data:, vbscript:, file:, ...) are rejected.
import "server-only";

export { isEmailSafeUrl } from "@/lib/email/schemas";
