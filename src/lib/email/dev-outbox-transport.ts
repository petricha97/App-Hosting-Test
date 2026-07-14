// Dev outbox transport (M6-T1, decision Q2): "sending" in dev IS writing the
// outbox row — this transport performs NO network I/O and reports success,
// so the EmailMessage doc the send service persisted is the entire delivery.
// Spec: agents/docs/specs/m6-email-infrastructure.md (§1).
//
// PRODUCTION-FILE IMPORT RULE: only the factory in transport.ts may import
// this module (asserted by the import-boundary test) — every caller depends
// on the EmailTransport interface alone.
//
// PII: never logs subjects, bodies or recipients — the outbox doc is the
// only place rendered content lands.
import "server-only";

import type {
  EmailTransport,
  SendEmailInput,
  SendEmailResult,
} from "@/lib/email/transport";

// Provider-id prefix — makes dev "deliveries" self-describing in the outbox
// UI (T2) and unambiguous in logs/exports.
export const DEV_OUTBOX_PROVIDER_ID_PREFIX = "dev-";

export function createDevOutboxTransport(): EmailTransport {
  return {
    async send(input: SendEmailInput): Promise<SendEmailResult> {
      return {
        status: "sent",
        providerMessageId: `${DEV_OUTBOX_PROVIDER_ID_PREFIX}${input.messageId}`,
      };
    },
  };
}
