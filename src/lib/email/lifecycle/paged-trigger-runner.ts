// The generic paged-send engine shared by all three periodic triggers (§3
// abandoned-24h, §4 unpaid-offsets, §5 scheduled) — spec
// agents/docs/specs/m6-lifecycle-triggers.md §8: bounded pages, per-page
// `enabled` re-check, resumable across ticks via a cursor, never an
// unbounded query or an unbounded sendEventEmailBatch call.
//
// One trigger-specific behavior is injected per call: `buildDedupeKeys`
// turns one AudienceCandidate into ZERO OR MORE logical sends (zero = "not
// yet due, skip"; §4 unpaid-offsets can return up to three — one per
// 7/14/21 offset that is currently due for that order).
import "server-only";

import { deriveBodyForDefinition } from "@/features/emails/server/render";
import { resolveEmailBlockRenderContext } from "@/features/emails/server/resolve-block-context";
import { buildEmailMergeContext } from "@/lib/email/merge-context";
import { emailRecipientSchema } from "@/lib/email/schemas";
import {
  sendEventEmail,
  sendEventEmailBatch,
  type SendEventEmailBatchRecipient,
} from "@/lib/email/send-service";
import type { EmailTransport } from "@/lib/email/transport";
import type { EmailPuckBlock, EventDoc, WithId } from "@/types/collection";
import { isDefinitionCurrentlyEnabled } from "./definition-enabled";
import { mintAttendeeQrSvg, templateUsesQrCode } from "./qr";
import type {
  AudienceCandidate,
  AudiencePageResult,
  TriggerEvalOutcome,
} from "./types";

export type LifecycleEventInput = WithId<
  Pick<EventDoc, "name" | "periods" | "timezone">
>;

export interface RunPagedLifecycleTriggerInput {
  kind: string;
  organizationId: string;
  eventId: string;
  eventName: string;
  event: LifecycleEventInput;
  definitionId: string | null;
  template: {
    subject: string;
    body: string;
    // M6-T4 — optional, additive (spec Shared decisions): a caller that
    // omits these reproduces the exact pre-T4 plain-text behavior.
    bodyMode?: "text" | "blocks";
    bodyBlocks?: EmailPuckBlock[];
  };
  transport?: EmailTransport;
  pageSize: number;
  maxPages: number;
  // Fetches ONE page of candidates given the cursor from the previous page
  // (null = first page). Each audience/trigger supplies its own source
  // (audience-queries.ts's dispatcher, or the Order-first traversal for
  // unpaid-offsets).
  fetchPage: (startAfterMs: number | null) => Promise<AudiencePageResult>;
  // Zero or more dedupeKeys for this candidate — empty = not eligible this
  // tick (skip, no send, no write).
  buildDedupeKeys: (candidate: AudienceCandidate) => string[];
}

function outcomeFrom(): TriggerEvalOutcome {
  return {
    pagesProcessed: 0,
    enqueued: 0,
    duplicates: 0,
    rejected: 0,
    failed: 0,
    stoppedReason: "exhausted",
  };
}

async function buildCandidateContext(input: {
  candidate: AudienceCandidate;
  event: LifecycleEventInput;
  eventId: string;
  needsQrCode: boolean;
}) {
  let qrCodeSvg: string | null = null;
  if (input.needsQrCode && input.candidate.submissionId) {
    qrCodeSvg = await mintAttendeeQrSvg({
      eventId: input.eventId,
      submissionId: input.candidate.submissionId,
    });
  }
  return buildEmailMergeContext({
    event: input.event,
    qrCodeSvg,
    ...input.candidate.mergeInput,
  });
}

export async function runPagedLifecycleTrigger(
  input: RunPagedLifecycleTriggerInput,
): Promise<TriggerEvalOutcome> {
  const outcome = outcomeFrom();
  // M6-T4: bodyMode/bodyBlocks may be set (block-designed periodic email) —
  // derive ONCE per tick (the assembled HTML/text is identical for every
  // recipient page; only the per-recipient MERGE-TAG substitution differs,
  // which sendEventEmail/sendEventEmailBatch already apply downstream).
  //
  // M6-T4 B-1 fix: resolveEmailBlockRenderContext wires live
  // TicketPricingTable/RegistrationEmbed/CountdownTimer data, also resolved
  // ONCE per tick — the same snapshot semantics as bodyHtml/bodyText above,
  // never re-fetched per page or per recipient (spec §1 AC-9). It never
  // throws on its own (every sub-resolution is independently failure-
  // isolated), so a lookup failure here can only ever degrade to an empty
  // context, never abort the tick.
  const blockContext = await resolveEmailBlockRenderContext({
    eventId: input.eventId,
    organizationId: input.organizationId,
  });
  const { bodyHtml, bodyText } = deriveBodyForDefinition(
    input.template,
    blockContext,
  );
  // {qr_code} usage is checked against the DERIVED plain-text body — this
  // generalizes correctly to block mode without templateUsesQrCode needing
  // to know about blocks: a block-designed email that embeds {qr_code} in
  // any text-bearing field still appears in bodyText (spec §3.3's own
  // "walks block props directly" derivation), so the pre-check remains
  // accurate whether the definition is plain-text or block-authored.
  const needsQrCode = templateUsesQrCode({
    subject: input.template.subject,
    body: bodyText,
  });
  let cursor: number | null = null;

  for (let page = 0; page < input.maxPages; page += 1) {
    // §8: re-read `enabled` fresh at the start of EVERY processed page, not
    // once per tick and not once per recipient.
    const enabled = await isDefinitionCurrentlyEnabled({
      kind: input.kind,
      eventId: input.eventId,
      organizationId: input.organizationId,
    });
    if (!enabled) {
      outcome.stoppedReason = "disabled";
      break;
    }

    const pageResult = await input.fetchPage(cursor);
    outcome.pagesProcessed += 1;

    // Split BEFORE batching: a single malformed recipient must never poison
    // an otherwise-valid page (sendEventEmailBatch's own contract is
    // documented all-or-nothing on recipient validation, T1 edge case 4) —
    // invalid entries are sent individually so each gets its own typed
    // INVALID_RECIPIENT rejection (spec §3 AC-4) with zero write, while
    // valid peers still batch together.
    const validRecipients: SendEventEmailBatchRecipient[] = [];
    const invalidCandidates: AudienceCandidate[] = [];

    for (const candidate of pageResult.candidates) {
      const dedupeKeys = input.buildDedupeKeys(candidate);
      if (dedupeKeys.length === 0) continue;

      const parsed = emailRecipientSchema.safeParse(candidate.recipient);
      if (!parsed.success) {
        invalidCandidates.push(candidate);
        outcome.rejected += dedupeKeys.length;
        continue;
      }

      const context = await buildCandidateContext({
        candidate,
        event: input.event,
        eventId: input.eventId,
        needsQrCode,
      });

      for (const dedupeKey of dedupeKeys) {
        validRecipients.push({
          recipient: candidate.recipient,
          dedupeKey,
          context,
          attendeeId: candidate.attendeeId,
          submissionId: candidate.submissionId,
        });
      }
    }

    // Individually-sent invalid recipients — typed rejections, zero writes,
    // never block the batch or the rest of the tick (spec §3 AC-4).
    for (const candidate of invalidCandidates) {
      for (const dedupeKey of input.buildDedupeKeys(candidate)) {
        await sendEventEmail({
          organizationId: input.organizationId,
          eventId: input.eventId,
          eventName: input.eventName,
          kind: input.kind,
          dedupeKey,
          definitionId: input.definitionId,
          recipient: candidate.recipient,
          attendeeId: candidate.attendeeId,
          submissionId: candidate.submissionId,
          template: {
            subject: input.template.subject,
            bodyHtml,
            bodyText,
          },
          // sendEventEmail rejects an invalid recipient at step 1, BEFORE
          // context is ever used — an empty context avoids paying for QR
          // minting (or any other context work) on a send that can never
          // reach render.
          context: {},
          transport: input.transport,
        });
      }
    }

    if (validRecipients.length > 0) {
      const result = await sendEventEmailBatch({
        organizationId: input.organizationId,
        eventId: input.eventId,
        eventName: input.eventName,
        kind: input.kind,
        definitionId: input.definitionId,
        template: {
          subject: input.template.subject,
          bodyHtml,
          bodyText,
        },
        recipients: validRecipients,
        transport: input.transport,
      });

      if (result.ok) {
        outcome.enqueued += result.enqueued;
        for (const entry of result.results) {
          if (entry.outcome === "duplicate") outcome.duplicates += 1;
          if (entry.outcome === "failed") outcome.failed += 1;
          if (entry.outcome === "rejected") outcome.rejected += 1;
        }
      } else {
        // Should not happen (pre-filtered above) — surfaced defensively
        // rather than swallowed.
        outcome.rejected += result.invalid.length;
      }
    }

    if (!pageResult.hasMore || pageResult.nextCursorMs === null) {
      outcome.stoppedReason = "exhausted";
      break;
    }
    cursor = pageResult.nextCursorMs;
    if (page === input.maxPages - 1) {
      outcome.stoppedReason = "budget";
    }
  }

  return outcome;
}
