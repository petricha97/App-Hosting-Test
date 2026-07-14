// The email send service (M6-T1) — the ONLY module that orchestrates a send:
// rendering, validation, persistence and status transitions all happen HERE,
// above the transport (which receives fully rendered strings and nothing
// else). Spec: agents/docs/specs/m6-email-infrastructure.md (§1/§2/§6).
//
// NO HTTP surface in T1: enqueue is a server-side service invoked by server
// code only (T3's hooks, T2's manual-send routes — which gate session ->
// org -> getAdminEventForOrganization -> write:events before calling in).
//
// Failure taxonomy (deliberate, edge case 4):
// - VALIDATION failures (invalid recipient, oversized rendered content) are
//   TYPED REJECTIONS with ZERO writes — caller bugs never mint `failed`
//   outbox rows;
// - TRANSPORT failures (throw, failed result, unknown EMAIL_TRANSPORT
//   config) land the already-created row `failed` with a bounded lastError
//   and return a typed failure — never an unhandled exception;
// - DUPLICATES (same org/event/kind/recipient/dedupeKey) return the
//   existing row untouched and NEVER invoke the transport again.
import "server-only";

import {
  createAdminEmailMessageIfAbsent,
  markAdminEmailMessageFailed,
  markAdminEmailMessageSent,
  retryFailedEmailMessage,
} from "@/lib/db/adminEmailMessage";
import type { EmailMergeContext } from "@/lib/email/merge-tags";
import {
  renderEmailTemplate,
  type EmailTemplateInput,
} from "@/lib/email/merge-tags";
import {
  emailRecipientSchema,
  emailSenderIdentitySchema,
  validateRenderedEmailContent,
} from "@/lib/email/schemas";
import { resolveEmailSenderIdentity } from "@/lib/email/sender-identity";
import { getEmailTransport, type EmailTransport } from "@/lib/email/transport";
import type {
  EmailMessageDoc,
  EmailMessageStatus,
  WithId,
} from "@/types/collection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendEventEmailInput {
  organizationId: string;
  eventId: string;
  // For the default sender identity (fromName = event name) — callers have
  // the event doc loaded already (route gating), so no extra read here.
  eventName: string;
  // Free-text logical send kind ("confirmation-paid", "manual", …) — part
  // of the deterministic outbox id and T2's definition join key.
  kind: string;
  // Caller-supplied idempotency scope per logical send (submissionId, an
  // ISO date for a scheduled blast, a fresh uuid for ad-hoc sends). A
  // deliberate RE-send uses a NEW dedupeKey.
  dedupeKey: string;
  definitionId?: string | null;
  recipient: { name: string; email: string };
  attendeeId?: string | null;
  submissionId?: string | null;
  // Un-rendered template + per-recipient context — the service renders.
  template: EmailTemplateInput;
  context: EmailMergeContext;
  // Test/DI seam (§1 AC-1): production callers omit it and the fail-closed
  // factory (EMAIL_TRANSPORT env) decides.
  transport?: EmailTransport;
}

export interface RenderReport {
  usedTags: string[];
  missingTags: string[];
  unknownTags: string[];
}

export type SendEventEmailRejectionCode =
  "INVALID_RECIPIENT" | "CONTENT_TOO_LARGE" | "RENDER_FAILED";

export type SendEventEmailResult =
  | {
      ok: true;
      outcome: "sent";
      messageId: string;
      providerMessageId: string | null;
      renderReport: RenderReport;
    }
  // The logical send already has a row — returned untouched, zero writes,
  // no transport call (§2 AC-1).
  | {
      ok: true;
      outcome: "duplicate";
      messageId: string;
      status: EmailMessageStatus;
    }
  // Transport / configuration / sender-identity failure: the outbox row
  // exists and is `failed` with this reason (retryable via
  // retryEmailMessage).
  | { ok: false; outcome: "failed"; messageId: string; reason: string }
  // Validation rejection: NO outbox row was written (caller error).
  | {
      ok: false;
      outcome: "rejected";
      code: SendEventEmailRejectionCode;
      message: string;
    };

// ---------------------------------------------------------------------------
// Single send
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

// Lands the row `failed` and CHECKS the transition result — this module's
// contract is typed results everywhere, so a transition that does not land
// (NOT_FOUND / INVALID_STATUS) is logged loudly, never silently swallowed.
// The caller's outcome is already `failed` with the transport reason.
async function markMessageFailedChecked(input: {
  messageId: string;
  eventId: string;
  organizationId: string;
  reason: string;
}): Promise<void> {
  const transition = await markAdminEmailMessageFailed({
    messageId: input.messageId,
    eventId: input.eventId,
    organizationId: input.organizationId,
    errorMessage: input.reason,
  });
  if (!transition.ok) {
    console.error(
      "[email/send-service] failed transition did not land " +
        `(${transition.code}) messageId=${input.messageId}`,
    );
  }
}

// Resolves the transport, invokes it, and lands the row's terminal status.
// The row ALREADY exists (status queued) when this runs — every failure
// path here marks it `failed` with a bounded reason (§1 AC-3/AC-4).
async function deliverQueuedMessage(input: {
  messageId: string;
  message: Pick<
    EmailMessageDoc,
    | "organizationId"
    | "eventId"
    | "from"
    | "replyTo"
    | "recipient"
    | "subject"
    | "bodyHtml"
    | "bodyText"
  >;
  transport?: EmailTransport;
}): Promise<
  { ok: true; providerMessageId: string | null } | { ok: false; reason: string }
> {
  const scope = {
    messageId: input.messageId,
    eventId: input.message.eventId,
    organizationId: input.message.organizationId,
  };

  let transport: EmailTransport;
  try {
    // Fail-closed factory: an unknown EMAIL_TRANSPORT throws a descriptive
    // configuration error — the row lands `failed` with it, never a silent
    // fake "sent" (§1 AC-3).
    transport = input.transport ?? getEmailTransport();
  } catch (error: unknown) {
    const reason = errorMessage(error);
    await markMessageFailedChecked({ ...scope, reason });
    return { ok: false, reason };
  }

  let result: {
    status: "sent" | "failed";
    providerMessageId: string | null;
    failureReason?: string;
  };
  try {
    result = await transport.send({
      messageId: input.messageId,
      from: input.message.from,
      replyTo: input.message.replyTo,
      to: {
        name: input.message.recipient.name,
        address: input.message.recipient.email,
      },
      subject: input.message.subject,
      bodyHtml: input.message.bodyHtml,
      bodyText: input.message.bodyText,
    });
  } catch (error: unknown) {
    result = {
      status: "failed",
      providerMessageId: null,
      failureReason: errorMessage(error),
    };
  }

  if (result.status === "sent") {
    const transition = await markAdminEmailMessageSent({
      ...scope,
      providerMessageId: result.providerMessageId,
    });
    if (!transition.ok) {
      // The transport accepted the message but the outbox row did not move
      // — NEVER report "sent" on top of a doc that says otherwise (S-2:
      // typed transition results are checked, not swallowed).
      const reason =
        "Transport accepted the message but the sent transition did not " +
        `land (${transition.code}).`;
      console.error(
        `[email/send-service] ${reason} messageId=${input.messageId}`,
      );
      return { ok: false, reason };
    }
    return { ok: true, providerMessageId: result.providerMessageId };
  }

  const reason = result.failureReason ?? "Transport reported failure.";
  await markMessageFailedChecked({ ...scope, reason });
  return { ok: false, reason };
}

export async function sendEventEmail(
  input: SendEventEmailInput,
): Promise<SendEventEmailResult> {
  // 1. Recipient validation — invalid recipients are TYPED rejections, no
  //    outbox row (edge case 4).
  const recipientParsed = emailRecipientSchema.safeParse(input.recipient);
  if (!recipientParsed.success) {
    return {
      ok: false,
      outcome: "rejected",
      code: "INVALID_RECIPIENT",
      message: recipientParsed.error.issues
        .map((issue) => issue.message)
        .join(" "),
    };
  }
  const recipient = recipientParsed.data;

  // 2. Render (pure — per-recipient context) BEFORE any write.
  let rendered: ReturnType<typeof renderEmailTemplate>;
  try {
    rendered = renderEmailTemplate(input.template, input.context);
  } catch (error: unknown) {
    // The renderer itself never throws for tag issues; this guards corrupt
    // context objects (edge case 5) so batch peers stay unaffected.
    return {
      ok: false,
      outcome: "rejected",
      code: "RENDER_FAILED",
      message: errorMessage(error),
    };
  }

  // 3. Size + header-safety limits on the RENDERED output — rejected before
  //    any write, so caller bugs never orphan `failed` rows (edge case 3).
  //    On ok the SANITIZED content comes back (control chars stripped from
  //    the subject even when they originate in the template itself, S-3) —
  //    everything persisted/sent below uses `content`, never `rendered`.
  const contentCheck = validateRenderedEmailContent(rendered);
  if (!contentCheck.ok) {
    return {
      ok: false,
      outcome: "rejected",
      code: "CONTENT_TOO_LARGE",
      message: `Rendered content exceeds limits: ${contentCheck.issues.join(", ")}.`,
    };
  }
  const content = contentCheck.content;

  // 4. Sender identity: stored EmailSettings or read-time defaults, then
  //    RE-validated (§4 AC-3 defense in depth). An invalid identity still
  //    writes the row — then lands it `failed` (never sent with a malformed
  //    header, and the audit trail shows what was attempted).
  const identity = await resolveEmailSenderIdentity({
    eventId: input.eventId,
    organizationId: input.organizationId,
    eventName: input.eventName,
  });
  const identityParsed = emailSenderIdentitySchema.safeParse({
    fromName: identity.fromName,
    fromAddress: identity.fromAddress,
    replyTo: identity.replyTo,
  });

  const from = identityParsed.success
    ? {
        name: identityParsed.data.fromName,
        address: identityParsed.data.fromAddress,
      }
    : { name: identity.fromName, address: identity.fromAddress };
  const replyTo = identityParsed.success
    ? identityParsed.data.replyTo
    : identity.replyTo;

  // 5. Create-if-absent at the deterministic id — duplicates return the
  //    existing row with zero writes and AT MOST ONE transport call ever.
  const createResult = await createAdminEmailMessageIfAbsent({
    organizationId: input.organizationId,
    eventId: input.eventId,
    definitionId: input.definitionId ?? null,
    kind: input.kind,
    dedupeKey: input.dedupeKey,
    recipient,
    attendeeId: input.attendeeId ?? null,
    submissionId: input.submissionId ?? null,
    from,
    replyTo,
    subject: content.subject,
    bodyHtml: content.bodyHtml,
    bodyText: content.bodyText,
  });

  if (!createResult.created) {
    return {
      ok: true,
      outcome: "duplicate",
      messageId: createResult.messageId,
      status: createResult.message.status,
    };
  }

  if (!identityParsed.success) {
    const reason =
      "Sender identity failed validation at send time: " +
      identityParsed.error.issues.map((issue) => issue.message).join(" ");
    await markMessageFailedChecked({
      messageId: createResult.messageId,
      eventId: input.eventId,
      organizationId: input.organizationId,
      reason,
    });
    return {
      ok: false,
      outcome: "failed",
      messageId: createResult.messageId,
      reason,
    };
  }

  // 6. Deliver (transport failure -> row `failed`, typed result).
  const delivery = await deliverQueuedMessage({
    messageId: createResult.messageId,
    message: createResult.message,
    transport: input.transport,
  });

  if (!delivery.ok) {
    return {
      ok: false,
      outcome: "failed",
      messageId: createResult.messageId,
      reason: delivery.reason,
    };
  }

  return {
    ok: true,
    outcome: "sent",
    messageId: createResult.messageId,
    providerMessageId: delivery.providerMessageId,
    renderReport: {
      usedTags: rendered.usedTags,
      missingTags: rendered.missingTags,
      unknownTags: rendered.unknownTags,
    },
  };
}

// ---------------------------------------------------------------------------
// Batch enqueue (T3's "Email all" substrate)
// ---------------------------------------------------------------------------

export interface SendEventEmailBatchRecipient {
  recipient: { name: string; email: string };
  dedupeKey: string;
  context: EmailMergeContext;
  attendeeId?: string | null;
  submissionId?: string | null;
}

export interface SendEventEmailBatchInput {
  organizationId: string;
  eventId: string;
  eventName: string;
  kind: string;
  definitionId?: string | null;
  template: EmailTemplateInput;
  recipients: SendEventEmailBatchRecipient[];
  transport?: EmailTransport;
}

export type SendEventEmailBatchResult =
  // enqueued = NEW outbox rows written (duplicates don't count). An empty
  // recipient list is a calm success no-op (edge case 2).
  | {
      ok: true;
      enqueued: number;
      results: Array<{ email: string } & SendEventEmailResult>;
    }
  // ALL-OR-NOTHING on recipient validation (edge case 4): the invalid
  // entries are reported and NOTHING is written. (T3 may relax to
  // partial-accept with per-row results if segmentation needs it —
  // documented seam.)
  | {
      ok: false;
      code: "INVALID_RECIPIENTS";
      invalid: Array<{ index: number; email: string; message: string }>;
    };

export async function sendEventEmailBatch(
  input: SendEventEmailBatchInput,
): Promise<SendEventEmailBatchResult> {
  if (input.recipients.length === 0) {
    return { ok: true, enqueued: 0, results: [] };
  }

  // Validate EVERY recipient before any write (all-or-nothing).
  const invalid: Array<{ index: number; email: string; message: string }> = [];
  input.recipients.forEach((entry, index) => {
    const parsed = emailRecipientSchema.safeParse(entry.recipient);
    if (!parsed.success) {
      invalid.push({
        index,
        email: entry.recipient.email,
        message: parsed.error.issues.map((issue) => issue.message).join(" "),
      });
    }
  });
  if (invalid.length > 0) {
    return { ok: false, code: "INVALID_RECIPIENTS", invalid };
  }

  // Sequential sends: rendering happens per-recipient right before that
  // recipient's doc is created — one bad context / oversized render fails
  // THAT entry (typed, in results) without poisoning the rest (edge 5).
  const results: Array<{ email: string } & SendEventEmailResult> = [];
  let enqueued = 0;

  for (const entry of input.recipients) {
    const result = await sendEventEmail({
      organizationId: input.organizationId,
      eventId: input.eventId,
      eventName: input.eventName,
      kind: input.kind,
      dedupeKey: entry.dedupeKey,
      definitionId: input.definitionId ?? null,
      recipient: entry.recipient,
      attendeeId: entry.attendeeId ?? null,
      submissionId: entry.submissionId ?? null,
      template: input.template,
      context: entry.context,
      transport: input.transport,
    });

    // A new row was written unless the send was a duplicate or a rejection.
    if (result.outcome === "sent" || result.outcome === "failed") {
      enqueued += 1;
    }
    results.push({ email: entry.recipient.email, ...result });
  }

  return { ok: true, enqueued, results };
}

// ---------------------------------------------------------------------------
// Explicit retry (failed -> queued -> transport re-attempt)
// ---------------------------------------------------------------------------

export type RetryEmailMessageResult =
  | {
      ok: true;
      outcome: "sent";
      messageId: string;
      providerMessageId: string | null;
    }
  | { ok: false; outcome: "failed"; messageId: string; reason: string }
  // Typed no-op: the doc is "sent" (terminal) or already "queued" — zero
  // writes (§2 AC-4). "not-found" doubles as cross-org (IDOR-safe).
  | { ok: false; outcome: "not-retryable"; status?: EmailMessageStatus }
  | { ok: false; outcome: "not-found" };

export async function retryEmailMessage(input: {
  messageId: string;
  eventId: string;
  organizationId: string;
  transport?: EmailTransport;
}): Promise<RetryEmailMessageResult> {
  const transition = await retryFailedEmailMessage({
    messageId: input.messageId,
    eventId: input.eventId,
    organizationId: input.organizationId,
  });

  if (!transition.ok) {
    return transition.code === "NOT_FOUND"
      ? { ok: false, outcome: "not-found" }
      : { ok: false, outcome: "not-retryable", status: transition.status };
  }

  const message: WithId<EmailMessageDoc> = transition.message;

  // Re-check the STORED from/replyTo snapshot before re-sending (§4 AC-3:
  // a doc corrupted out-of-band lands `failed`, never a malformed header).
  const identityParsed = emailSenderIdentitySchema.safeParse({
    fromName: message.from.name,
    fromAddress: message.from.address,
    replyTo: message.replyTo,
  });
  if (!identityParsed.success) {
    const reason =
      "Stored sender identity failed validation at retry: " +
      identityParsed.error.issues.map((issue) => issue.message).join(" ");
    await markMessageFailedChecked({
      messageId: input.messageId,
      eventId: input.eventId,
      organizationId: input.organizationId,
      reason,
    });
    return { ok: false, outcome: "failed", messageId: input.messageId, reason };
  }

  const delivery = await deliverQueuedMessage({
    messageId: input.messageId,
    message,
    transport: input.transport,
  });

  if (!delivery.ok) {
    return {
      ok: false,
      outcome: "failed",
      messageId: input.messageId,
      reason: delivery.reason,
    };
  }

  return {
    ok: true,
    outcome: "sent",
    messageId: input.messageId,
    providerMessageId: delivery.providerMessageId,
  };
}
