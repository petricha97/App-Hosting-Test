// Basic per-IP rate limiting for the UNAUTHENTICATED public registration
// endpoints. Spec: agents/docs/specs/m3-registration-paths.md (Shared
// decisions): "Rate limiting (basic, per-IP): in-memory token bucket per
// route (e.g. 30 req/min/IP; promo validation 10/min/IP) — best-effort on
// serverless instances, documented as such; durable limiter is an M8
// hardening item. 429 with Retry-After."
//
// LIMITATIONS (documented per spec — accepted for M3):
// - State is per server instance and in-memory. On App Hosting / Cloud Run
//   each instance keeps its own buckets, so the effective limit scales with
//   instance count and resets on cold start. This is a best-effort abuse
//   dampener, not a security boundary; the security boundary remains strict
//   Zod validation + the signed draft-token capability.
// - IP extraction takes the RIGHTMOST NON-PRIVATE x-forwarded-for hop. On
//   Firebase App Hosting / GCLB the fronting proxy APPENDS the real client
//   IP to whatever the client sent, so the header arrives as
//   "<client-chosen junk...>, <real-ip>[, <internal-proxy>]" — left-most
//   entries are attacker-controlled and must never pick the bucket (review
//   S3 / security L-1). Locally it falls back to "unknown" (all local
//   traffic shares one bucket — fine for dev).
//
// Fixed-window counter (simpler than a token bucket, equivalent at these
// small limits): N requests per window per (route, ip); the window resets
// windowMs after its first request.

interface WindowState {
  count: number;
  resetAtMs: number;
}

const windows = new Map<string, WindowState>();

// Prevents unbounded memory growth from IP churn: opportunistically drop
// expired windows once the map grows past this size.
const SWEEP_THRESHOLD = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  // Seconds until the window resets — the 429 Retry-After value.
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  // Max requests per window.
  limit: number;
  // Window length; defaults to one minute (all spec limits are per minute).
  windowMs?: number;
  // Injectable clock for tests.
  nowMs?: number;
}

export function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  const nowMs = options.nowMs ?? Date.now();
  const windowMs = options.windowMs ?? 60_000;

  if (windows.size > SWEEP_THRESHOLD) {
    for (const [existingKey, state] of windows) {
      if (state.resetAtMs <= nowMs) windows.delete(existingKey);
    }
  }

  const existing = windows.get(key);
  if (!existing || existing.resetAtMs <= nowMs) {
    windows.set(key, { count: 1, resetAtMs: nowMs + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= options.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

// Private / reserved ranges that can only be internal proxy hops, never the
// real client: RFC 1918 (10/8, 172.16/12, 192.168/16), loopback, link-local
// (169.254/16), and the IPv6 equivalents (::1, fc00::/7, fe80::/10).
const PRIVATE_IP_PATTERN =
  /^(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|::1$|[fF][cCdD]|[fF][eE]80:)/;

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_PATTERN.test(ip);
}

// Best-effort client IP from proxy headers. x-forwarded-for is parsed
// RIGHT-TO-LEFT and the first non-private hop wins: GCLB appends the real
// client IP after any client-supplied entries (and internal proxies may
// append private hops after that), so the rightmost public address is the
// most trustworthy — the left-most is trivially spoofable (S3 / L-1).
export function getRequestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      if (!isPrivateIp(hops[i])) return hops[i];
    }
    // Every hop private (local/dev topologies): the rightmost is still the
    // closest to the proxy and not client-chosen in any fronting setup.
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

// Convenience wrapper used by the public registration routes: one bucket per
// (route name, client IP).
export function checkRequestRateLimit(
  request: Request,
  routeName: string,
  limit: number,
): RateLimitResult {
  return checkRateLimit(`${routeName}:${getRequestIp(request)}`, { limit });
}

// Test seam: clears all buckets (in-memory state leaks across vitest cases
// otherwise).
export function resetRateLimits(): void {
  windows.clear();
}
