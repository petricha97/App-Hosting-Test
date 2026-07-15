// Firestore -> wire serialization for the M6-T2 routes (EmailMessage rows,
// EmailSettings). PURE shaping — no I/O — but kept under server/ since its
// input types (EmailMessageDoc etc.) are server-only DAL shapes.
import "server-only";

import type { SerializedEmailMessage } from "@/features/emails/types";
import type { EmailMessageDoc, WithId } from "@/types/collection";

function timestampToMillis(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { toMillis?: () => number; seconds?: number };
  if (typeof candidate.toMillis === "function") return candidate.toMillis();
  if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  return null;
}

export function serializeEmailMessage(
  doc: WithId<EmailMessageDoc>,
): SerializedEmailMessage {
  return {
    id: doc.id,
    kind: doc.kind,
    definitionId: doc.definitionId,
    recipient: { name: doc.recipient.name, email: doc.recipient.email },
    subject: doc.subject,
    bodyHtml: doc.bodyHtml,
    bodyText: doc.bodyText,
    status: doc.status,
    attemptCount: doc.attemptCount,
    lastError: doc.lastError
      ? {
          message: doc.lastError.message,
          atMs: timestampToMillis(doc.lastError.at),
        }
      : null,
    providerMessageId: doc.providerMessageId,
    queuedAtMs: timestampToMillis(doc.queuedAt),
    sentAtMs: timestampToMillis(doc.sentAt),
    failedAtMs: timestampToMillis(doc.failedAt),
    createdAtMs: timestampToMillis(doc.createdAt),
  };
}
