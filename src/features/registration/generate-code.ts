// Client-safe suggested identifiers shared by ticket and registration-type forms.
// Uniqueness remains a server check; users can edit a suggestion before saving.

/** Suggests a valid 2–12 character code from a name, using a fallback for names without Latin letters or digits. */
export function generateRegistrationCode(
  name: string,
  fallback = "TICKET",
): string {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const code = normalized
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 12)
    .replace(/-+$/g, "");
  if (code.length >= 2) return code;
  if (code) return `${code}-1`;
  const safeFallback = fallback
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  return safeFallback.length >= 2 ? safeFallback : "TICKET";
}
