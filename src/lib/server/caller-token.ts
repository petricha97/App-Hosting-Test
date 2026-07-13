// Shared caller-token resolution for the /api/organizations/* routes.
// Prefers an Authorization: Bearer <idToken> header (surfaces where the
// session cookie has not been minted yet, e.g. mid-signup) and falls back to
// the session cookie (logged-in dashboard surfaces). Verification is always
// the caller's next step via decodeUser (Admin SDK) — this helper only
// EXTRACTS the token, it never trusts it.
import "server-only";

import { cookies } from "next/headers";

const SESSION_COOKIE = "session";

export async function resolveCallerToken(
  request: Request,
): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice("bearer ".length).trim();
    if (token) return token;
  }
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}
