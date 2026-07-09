// Shared code rules for RegistrationType and TicketType (M1 registration spine).
// Pure module — no Firebase imports — so it is safe to use from client repos,
// admin repos, and feature-level Zod schemas alike.
//
// Codes are stored uppercase and are unique per event *within their own
// collection* (case-insensitive). Uniqueness is enforced by normalizing to
// uppercase before every write AND before every eventId+code lookup, so the
// equality query is effectively case-insensitive.

// 2–12 chars, uppercase letters/digits/hyphen/slash, must start alphanumeric.
// Slash is reserved for comp variants (e.g. "DEL-COMP", "GC/C").
export const REGISTRATION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9/-]{1,11}$/;

// Canonical storage form of a code. Apply on every write and every code lookup.
export function normalizeRegistrationCode(code: string): string {
  return code.trim().toUpperCase();
}

// Convenience validator for schemas: normalize first, then test.
export function isValidRegistrationCode(code: string): boolean {
  return REGISTRATION_CODE_PATTERN.test(normalizeRegistrationCode(code));
}
