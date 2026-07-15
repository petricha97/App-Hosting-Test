// Shared ≤32KB JSON body reader for the M6-T2 dashboard email routes (spec
// §7: "Zod + unknown-key strip + ≤32 KB bodies" — same cap family as the
// public registration routes' MAX_PUBLIC_BODY_BYTES, applied here to the
// authenticated dashboard surface).
import "server-only";

export const MAX_EMAIL_ROUTE_BODY_BYTES = 32 * 1024;

export async function readEmailRouteJsonBody(
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

  if (new TextEncoder().encode(text).length > MAX_EMAIL_ROUTE_BODY_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
