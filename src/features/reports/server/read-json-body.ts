// Shared ≤32KB JSON body reader for the M7-T3 schedule CRUD routes — same
// cap family as every other M1-M7 mutating dashboard route (spec §4:
// "Zod-validated request bodies (≤32 KB)"). Mirrors
// src/features/emails/server/read-json-body.ts exactly; duplicated
// per-feature rather than shared, matching this codebase's own established
// convention (src/features/public-registration/server/context.ts has its
// own copy too).
import "server-only";

export const MAX_REPORTS_ROUTE_BODY_BYTES = 32 * 1024;

export async function readReportsRouteJsonBody(
  request: Request,
): Promise<
  { ok: true; body: unknown } | { ok: false; reason: "too_large" | "invalid" }
> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (new TextEncoder().encode(text).length > MAX_REPORTS_ROUTE_BODY_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
