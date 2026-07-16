// Real-time `on-submit` trigger (approval-pending) — spec:
// agents/docs/specs/m6-lifecycle-triggers.md §1.
//
// REPLAY SAFETY LIVES AT THE CALL SITE, NOT HERE: this function fires
// unconditionally when called — the two callers (finalize route, legacy
// public register route) are responsible for invoking it ONLY when the
// FormData create-if-absent call they just made actually created a brand
// new "new" submission (`created === true` for the stepper's
// createAdminFormDataForDraft; the legacy createAdminFormData has no replay
// path, so it always mints a fresh doc and always calls this). The admin
// manual-registration route (attendees/register/route.ts) creates FormData
// via createAdminFormDataForDraft too, but never calls this module at all —
// it accepts immediately after, so "new" is a transient internal state a
// staff-entered registrant never sees an email for (spec §1: "skipping
// 'new' entirely").
//
// dedupeKey = submissionId (§1: "one submission -> at most one
// approval-pending email, ever").
import "server-only";

import { deriveBodyForDefinition } from "@/features/emails/server/render";
import { resolveEffectiveEmailDefinition } from "@/features/emails/server/resolve-definition";
import { resolveEmailBlockRenderContext } from "@/features/emails/server/resolve-block-context";
import { buildEmailMergeContext } from "@/lib/email/merge-context";
import { sendEventEmail } from "@/lib/email/send-service";
import type { EventDoc, WithId } from "@/types/collection";

export const APPROVAL_PENDING_KIND = "approval-pending";

export interface FireApprovalPendingEmailInput {
  organizationId: string;
  eventId: string;
  event: WithId<Pick<EventDoc, "name" | "periods" | "timezone">>;
  submissionId: string;
  // The FormData submission map — first_name/last_name/email are the
  // mandatory-field keys every real form carries (src/features/form/
  // default-fields.ts), the same keys the M5-T1 accept hook denormalizes.
  submission: Record<string, string>;
}

export async function fireApprovalPendingEmail(
  input: FireApprovalPendingEmailInput,
): Promise<void> {
  try {
    // enabled re-read at fire time, never cached (spec §1 "enabled check").
    const definition = await resolveEffectiveEmailDefinition({
      kind: APPROVAL_PENDING_KIND,
      eventId: input.eventId,
      organizationId: input.organizationId,
    });
    if (!definition || !definition.enabled) return;

    const email = (input.submission.email ?? "").trim();
    const name = [input.submission.first_name, input.submission.last_name]
      .filter((part) => typeof part === "string" && part.trim().length > 0)
      .join(" ")
      .trim();

    const context = buildEmailMergeContext({
      event: input.event,
      submission: input.submission,
    });

    // M6-T4: definition may be Plain-text or Block-designer authored —
    // deriveBodyForDefinition is the ONE place that branches on bodyMode,
    // reused unchanged by every real-time trigger (Shared decisions: "every
    // existing caller... gets block-designer support for free").
    //
    // M6-T4 B-1 fix: resolveEmailBlockRenderContext wires the live
    // TicketPricingTable/RegistrationEmbed/CountdownTimer data (resolved
    // ONCE for this single send, spec §1 AC-9's snapshot semantics) — it
    // never throws on its own (every sub-resolution is independently
    // failure-isolated internally), and this whole function is already
    // wrapped in the outer try/catch below, so a lookup failure here can
    // only ever degrade to an empty context, never block or crash this
    // send.
    const blockContext = await resolveEmailBlockRenderContext({
      eventId: input.eventId,
      organizationId: input.organizationId,
    });
    const { bodyHtml, bodyText } = deriveBodyForDefinition(
      definition,
      blockContext,
    );

    const result = await sendEventEmail({
      organizationId: input.organizationId,
      eventId: input.eventId,
      eventName: input.event.name,
      kind: APPROVAL_PENDING_KIND,
      dedupeKey: input.submissionId,
      definitionId: definition.definitionId,
      recipient: { name, email },
      submissionId: input.submissionId,
      template: {
        subject: definition.subject,
        bodyHtml,
        bodyText,
      },
      context,
    });

    if (!result.ok) {
      console.error(
        `[emails] approval-pending send failed for submission ${input.submissionId}: ` +
          (result.outcome === "rejected" ? result.message : result.reason),
      );
    }
  } catch (error) {
    // Failure isolation (spec §1): the FormData write already committed
    // before this runs — an email problem here must never surface as a
    // finalize/register failure. Log loudly, never rethrow.
    console.error(
      `[emails] on-submit approval-pending email crashed for submission ${input.submissionId}`,
      error,
    );
  }
}
