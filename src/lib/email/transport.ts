// Email transport abstraction (M6-T1, decision Q2: dev outbox transport
// behind a provider interface). The send service (send-service.ts) depends
// on THIS interface only — a real provider (SendGrid/SES/Resend) later is a
// new class + one factory branch, zero call-site changes. Mirrors the M2-T4
// PaymentProvider precedent (src/lib/payments/payment-provider.ts).
// Spec: agents/docs/specs/m6-email-infrastructure.md (§1).
//
// The transport receives FULLY RENDERED STRINGS ONLY — merge rendering,
// validation and persistence happen in the send service above it, so a
// future provider adapter is pure API mapping. The transport is STATELESS;
// the EmailMessage outbox doc is the source of truth.
import "server-only";

import { createDevOutboxTransport } from "@/lib/email/dev-outbox-transport";

export interface SendEmailInput {
  // The outbox doc id — doubles as the provider idempotency key.
  messageId: string;
  from: { name: string; address: string };
  replyTo: string | null;
  to: { name: string; address: string };
  // Fully rendered — the transport never renders.
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

export interface SendEmailResult {
  status: "sent" | "failed";
  providerMessageId: string | null;
  failureReason?: string;
}

export interface EmailTransport {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

// Selection env var. Optional — unset means the dev outbox (emails are
// persisted to Firestore and viewable, never actually delivered). No
// secrets are required for the dev transport (apphosting.yaml unchanged).
export const EMAIL_TRANSPORT_ENV = "EMAIL_TRANSPORT";

export const DEV_OUTBOX_TRANSPORT = "dev-outbox";

// Factory — the ONLY production module allowed to import a concrete
// transport implementation (import-boundary test asserts this).
//
// FAIL CLOSED (spec §1 AC-3): an unrecognized EMAIL_TRANSPORT value throws
// a descriptive configuration error at first use — a configured environment
// must never silently fall back to a non-sending transport. The send
// service catches this, lands the already-created outbox row `failed` with
// the reason, and returns a typed failure.
export function getEmailTransport(): EmailTransport {
  const configured = process.env[EMAIL_TRANSPORT_ENV]?.trim();

  if (!configured || configured === DEV_OUTBOX_TRANSPORT) {
    return createDevOutboxTransport();
  }

  throw new Error(
    `[email-transport] Unknown ${EMAIL_TRANSPORT_ENV} value "${configured}". ` +
      `The only implemented transport is "${DEV_OUTBOX_TRANSPORT}" (M6-T1, ` +
      "open question OQ-1: no real provider is wired yet). Unset the " +
      "variable or set it to the implemented transport — failing closed " +
      "instead of silently not sending.",
  );
}
