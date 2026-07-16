// M6-T4 B-1 follow-up — resolves an ABSOLUTE origin for building URLs that
// are embedded in outbound email HTML. This is a real constraint, not a
// style choice: `isEmailSafeUrl` (src/lib/email/schemas.ts, spec §3.1 step
// 2) rejects every relative/protocol-relative path by construction — only
// `http://`/`https://` absolute URLs can ever reach an `<a href>` in a
// rendered block (e.g. RegistrationEmbed's `registerHref`). `{event_url}`
// (merge-context.ts's `publicEventUrl`) gets to stay site-relative because
// it is a code-authored literal substituted AFTER the URL-safety gate, not
// a value that is itself passed through `isEmailSafeUrl` — a caller-
// supplied `EmailBlockRenderContext` field does not get that exemption.
//
// SOURCE: `NEXT_PUBLIC_APP_URL` ONLY (deploy-time configured, e.g.
// apphosting.yaml) — deliberately NOT derived from the incoming request's
// Host/X-Forwarded-Host headers. Those headers are client-controlled input
// (a request can carry an arbitrary Host value unless every hop in front of
// this service is proven to rewrite it); trusting them here would let a
// forged request cause a spoofed/attacker-controlled link to be embedded in
// a REAL outbound email (a phishing vector), not merely mis-render a page.
// The exact same "never trust caller-supplied input blindly" posture
// documented on `EmailRegistrationCtaContext.registerHref` (types.ts)
// applies transitively to how that href gets built in the first place.
//
// Returns null — NEVER throws — when the env var is unset or is not itself
// a well-formed absolute http(s) URL. Callers must degrade gracefully: an
// absent base URL means an "open" registration CTA context cannot be built,
// which callers treat the same as "no active paths" (RegistrationEmbed's
// honest, non-crashing empty-state fallback) until an operator configures
// the env var.
import "server-only";

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

export async function resolveEmailBaseUrl(): Promise<string | null> {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    // `.origin` both validates the value is a real absolute URL (a bare
    // relative path or malformed string already threw above) and
    // normalizes away any accidental trailing path/slash/query — the
    // configured value only ever needs to be an origin.
    return parsed.origin;
  } catch {
    return null;
  }
}
