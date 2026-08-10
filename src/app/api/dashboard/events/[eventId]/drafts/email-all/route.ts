// API route: POST /api/dashboard/events/[eventId]/drafts/email-all
// M6-T3 §7 — "Email all" on the M5-T3 Abandoned tab (M5-T3 shipped it
// disabled; wired here). Bulk-sends the SAME abandoned-reminder definition
// (T2's rendered subject/body, current EmailSettings sender identity) to
// every draft currently visible in the tab — every RegistrationDraft for
// this event with isAbandoned === true, via sendEventEmailBatch
// (src/lib/email/send-service.ts, built as this exact substrate — reused
// verbatim, never forked).
//
// Dedupe is SHARED with the automatic 24h trigger (spec §3): dedupeKey =
// draftId, same kind ("abandoned-reminder") — this is the ENTIRE safety
// mechanism. A draft the automation already emailed resolves as a duplicate
// here (skipped, not re-sent); a draft this click emails first is thereafter
// also "already sent" from the automation's perspective. Refuses (typed
// 409) when the definition itself is disabled — "Email all" is not gated on
// automated-firing state, but IS still gated on `enabled` (spec §7).
//
// Route convention (M1-M5, spec §9): session -> org -> write:events via
// resolveRegistrationRouteScope (401/403, 404 cross-org IDOR-safe),
// rate-limited.
import { NextResponse } from "next/server";

import { deriveBodyForDefinition } from "@/features/emails/server/render";
import { resolveEffectiveEmailDefinition } from "@/features/emails/server/resolve-definition";
import { resolveEmailBlockRenderContext } from "@/features/emails/server/resolve-block-context";
import {
  attachEmailTemplateVariables,
  loadEmailTemplateVariableSource,
} from "@/features/emails/server/template-variables";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { getAdminRegistrationDraftsForEvent } from "@/lib/db/adminRegistrationDraft";
import { buildEmailMergeContext } from "@/lib/email/merge-context";
import { emailRecipientSchema } from "@/lib/email/schemas";
import {
  sendEventEmailBatch,
  type SendEventEmailBatchRecipient,
} from "@/lib/email/send-service";
import { checkRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const ABANDONED_REMINDER_KIND = "abandoned-reminder";

export async function POST(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const rate = checkRateLimit(`emails-email-all:${scope.userId}:${eventId}`, {
    limit: 10,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many attempts — wait a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const definition = await resolveEffectiveEmailDefinition({
    kind: ABANDONED_REMINDER_KIND,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!definition) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }
  // Gated on `enabled` itself (spec §7) — NOT on the automation's own
  // firing state, which this route deliberately ignores.
  if (!definition.enabled) {
    return NextResponse.json(
      { error: "This email is off — turn it on before emailing everyone." },
      { status: 409 },
    );
  }

  const drafts = await getAdminRegistrationDraftsForEvent({
    eventId,
    organizationId: scope.organizationId,
  });
  const abandoned = drafts.filter((draft) => draft.isAbandoned);

  // Eligibility mirrors the automatic trigger's (spec §3): a draft abandoned
  // before any personal fields were entered has no email to send to.
  // sendEventEmail's own recipient validation would catch this per-entry,
  // but sendEventEmailBatch is ALL-OR-NOTHING on invalid recipients — one
  // blank-email draft must never block every OTHER eligible draft in the
  // batch, so it is filtered here rather than left to the batch call.
  const eligible = abandoned.filter(
    (draft) => typeof draft.email === "string" && draft.email.trim().length > 0,
  );
  const skippedNoEmail = abandoned.length - eligible.length;

  // Pre-split BEFORE batching (same pattern as
  // src/lib/email/lifecycle/paged-trigger-runner.ts's per-candidate
  // isolation) — sendEventEmailBatch is documented all-or-nothing on
  // recipient validation, so a single malformed draft email must never
  // block every OTHER eligible draft in this same click. Invalid entries
  // are counted, never sent, and never echoed back raw (Security L-3).
  const validRecipients: SendEventEmailBatchRecipient[] = [];
  let skippedInvalidEmail = 0;
  const variableSource = await loadEmailTemplateVariableSource({
    organizationId: scope.organizationId,
    event: scope.event,
  });

  for (const draft of eligible) {
    const name = [draft.firstName, draft.lastName]
      .filter((part) => typeof part === "string" && part.trim().length > 0)
      .join(" ")
      .trim();

    const parsed = emailRecipientSchema.safeParse({
      name,
      email: draft.email,
    });
    if (!parsed.success) {
      skippedInvalidEmail += 1;
      continue;
    }

    validRecipients.push({
      recipient: parsed.data,
      // SAME dedupe scheme as the automatic 24h trigger (spec §7) — the
      // entire safety mechanism.
      dedupeKey: draft.id,
      context: attachEmailTemplateVariables({
        context: buildEmailMergeContext({
          event: scope.event,
          submission: {
            first_name: draft.firstName ?? "",
            last_name: draft.lastName ?? "",
            email: draft.email ?? "",
          },
        }),
        source: variableSource,
      }),
    });
  }

  // M6-T4 B-1 fix: definition may be Plain-text or Block-designer authored —
  // same shared branch every real-time trigger uses, now resolved ONCE for
  // this whole batch (spec §1 AC-9's snapshot semantics — every recipient
  // in this click gets the identical assembled HTML, matching every other
  // paged/batch sender in this module).
  const blockContext = await resolveEmailBlockRenderContext({
    eventId,
    organizationId: scope.organizationId,
  });
  const { bodyHtml, bodyText } = deriveBodyForDefinition(
    definition,
    blockContext,
  );

  const result = await sendEventEmailBatch({
    organizationId: scope.organizationId,
    eventId,
    eventName: scope.event.name,
    kind: ABANDONED_REMINDER_KIND,
    definitionId: definition.definitionId,
    template: {
      subject: definition.subject,
      bodyHtml,
      bodyText,
    },
    recipients: validRecipients,
  });

  if (!result.ok) {
    // Should not happen — every recipient was pre-validated above with the
    // exact same schema sendEventEmailBatch re-checks. Surfaced defensively
    // (never swallowed) but WITHOUT echoing raw emails back to the caller's
    // browser (Security L-3) — a count is all a 400 response needs.
    return NextResponse.json(
      {
        error: "Some recipients were invalid.",
        invalidCount: result.invalid.length,
      },
      { status: 400 },
    );
  }

  const sent = result.results.filter(
    (entry) => entry.outcome === "sent",
  ).length;
  const alreadyEmailed = result.results.filter(
    (entry) => entry.outcome === "duplicate",
  ).length;
  const failed = result.results.filter(
    (entry) => entry.outcome === "failed",
  ).length;

  return NextResponse.json({
    ok: true,
    total: abandoned.length,
    attempted: validRecipients.length,
    sent,
    alreadyEmailed,
    failed,
    skippedNoEmail,
    skippedInvalidEmail,
  });
}
