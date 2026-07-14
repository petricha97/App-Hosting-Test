// Per-event sender identity resolution (M6-T1 §4): the stored EmailSettings
// doc when one exists, otherwise the documented READ-TIME defaults — never a
// lazy write (CheckinConfig read pattern). The send service snapshots the
// resolved identity into every outbox row; the from/replyTo addresses are
// NEVER merge-rendered (they come from here, not from templates).
// Spec: agents/docs/specs/m6-email-infrastructure.md (§4).
//
// Env posture (same family as QR_TOKEN_SECRET, src/lib/qr/qr-token.ts):
// - EMAIL_DEFAULT_FROM unset + dev-outbox transport -> "events@dev.local"
//   with a ONE-TIME console warn (nothing is actually delivered, so a dev
//   fallback is safe);
// - EMAIL_DEFAULT_FROM unset + a NON-dev transport configured -> FAIL
//   CLOSED (throw): a real provider must never send from a made-up address.
//   (Domain/DNS verification — SPF/DKIM — is a real-provider concern
//   deferred with OQ-1: an arbitrary from-address will NOT deliver once a
//   real transport lands.)
import "server-only";

import { getAdminEmailSettingsForEvent } from "@/lib/db/adminEmailSettings";
import { stripControlChars } from "@/lib/email/schemas";
import {
  DEV_OUTBOX_TRANSPORT,
  EMAIL_TRANSPORT_ENV,
} from "@/lib/email/transport";

export const EMAIL_DEFAULT_FROM_ENV = "EMAIL_DEFAULT_FROM";

// Dev/test-only fallback so local flows work without configuration —
// paired with the dev-outbox transport, which never delivers anything.
export const DEV_FALLBACK_FROM_ADDRESS = "events@dev.local";

let warnedFallback = false;

export function resolveDefaultFromAddress(): string {
  const fromEnv = process.env[EMAIL_DEFAULT_FROM_ENV];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();

  const configuredTransport = process.env[EMAIL_TRANSPORT_ENV]?.trim();
  if (configuredTransport && configuredTransport !== DEV_OUTBOX_TRANSPORT) {
    throw new Error(
      `[email-sender] ${EMAIL_DEFAULT_FROM_ENV} is not set but a non-dev ` +
        `transport ("${configuredTransport}") is configured. A real ` +
        "transport must never send from the built-in dev fallback address " +
        "— set the env var (fail-closed; the fallback is dev-outbox only).",
    );
  }

  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      `[email-sender] ${EMAIL_DEFAULT_FROM_ENV} is not set — falling back ` +
        `to "${DEV_FALLBACK_FROM_ADDRESS}". Fine under the dev-outbox ` +
        "transport (nothing is delivered); a real transport fails closed " +
        "without the env var.",
    );
  }
  return DEV_FALLBACK_FROM_ADDRESS;
}

export interface ResolvedSenderIdentity {
  fromName: string;
  fromAddress: string;
  replyTo: string | null;
  // "settings" = stored EmailSettings doc; "defaults" = read-time defaults
  // (no doc — event name + EMAIL_DEFAULT_FROM).
  source: "settings" | "defaults";
}

// Header-safe default display name from the event name: the from-name
// schema rejects `"` `<` `>` outright (a stored doc SHOULD fail loudly),
// but a default derived from an event name must not make an event with a
// quote in its name unable to email — so the default is sanitized instead.
function defaultFromName(eventName: string): string {
  const sanitized = stripControlChars(eventName)
    .replace(/["<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return sanitized.length > 0 ? sanitized : "Events";
}

// Resolution only — the send service RE-VALIDATES the resolved identity
// through emailSenderIdentitySchema before every send (defense in depth,
// §4 AC-3), so corruption in a stored doc lands the message `failed`
// instead of ever producing a malformed header.
export async function resolveEmailSenderIdentity(input: {
  eventId: string;
  organizationId: string;
  eventName: string;
}): Promise<ResolvedSenderIdentity> {
  const stored = await getAdminEmailSettingsForEvent({
    eventId: input.eventId,
    organizationId: input.organizationId,
  });

  if (stored) {
    return {
      fromName: stored.fromName,
      fromAddress: stored.fromAddress,
      replyTo: stored.replyTo,
      source: "settings",
    };
  }

  return {
    fromName: defaultFromName(input.eventName),
    fromAddress: resolveDefaultFromAddress(),
    replyTo: null,
    source: "defaults",
  };
}
