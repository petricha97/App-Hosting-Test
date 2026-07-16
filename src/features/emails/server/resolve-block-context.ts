// M6-T4 B-1 follow-up — the ONE place every real call site resolves the
// live `EmailBlockRenderContext` (pricing / registrationCta / countdown)
// that RegistrationEmbed/TicketPricingTable/CountdownTimer need to render
// real content instead of their honest-but-empty fallback state (spec §1
// table). Review finding: agents/docs/reviews/m6-email-designer.md B-1 —
// this context was previously never constructed at any of the 7 production
// callers of deriveBodyForDefinition/renderEmailDefinitionPreview.
//
// Deliberately independent of whatever `event` shape a given caller already
// has in scope: this module re-resolves the full event doc itself from
// `eventId`/`organizationId` alone, so every call site's integration is the
// same one-line addition regardless of which (possibly narrow) Pick<EventDoc,
// ...> type it already threads around — paged-trigger-runner.ts and the two
// real-time trigger hooks in particular only carry
// Pick<EventDoc, "name" | "periods" | "timezone">, which lacks `formPath`
// (needed for the registration-CTA form lookup, same as the public event
// page's own resolution — src/app/events/[eventId]/page.tsx).
//
// Resolved ONCE per render/send — a SNAPSHOT (spec §1 AC-9's explicit
// freshness divergence from the public web page's live per-request
// re-fetch) — never re-resolved per recipient in a batch/page. Every
// sub-resolution is independently failure-isolated: a pricing/registration/
// event lookup that throws degrades that ONE field to null/undefined rather
// than ever blocking or crashing the caller's send — this function itself
// NEVER throws.
import "server-only";

import { resolveEventStartMs } from "@/features/event-pages/countdown";
import { resolveRegistrationCtaState } from "@/features/event-pages/registration-state";
import { listPublicTicketsForEvent } from "@/features/public-registration/server/tickets";
import type { PublicPricingProjection } from "@/features/public-registration/types";
import { resolveEventTimeZone } from "@/features/registration/utils";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminPublishedFormForPublicEvent } from "@/lib/db/adminForm";
import { getAdminRegistrationPathsForEvent } from "@/lib/db/adminRegistrationPath";
import { resolveEmailBaseUrl } from "@/lib/email/base-url";

import {
  EMPTY_EMAIL_BLOCK_RENDER_CONTEXT,
  type EmailBlockRenderContext,
  type EmailCountdownContext,
  type EmailRegistrationCtaContext,
} from "@/features/emails/server/blocks";

export interface ResolveEmailBlockRenderContextInput {
  eventId: string;
  organizationId: string;
}

// Best-effort only — swallows its OWN failure too (an exotic
// console.error/transport override throwing must never be the reason this
// module breaks its "never throw" contract).
function logResolutionError(
  field: string,
  eventId: string,
  error: unknown,
): void {
  try {
    console.error(
      `[emails] block-render context: ${field} resolution failed for event ${eventId}`,
      error,
    );
  } catch {
    // Logging is not allowed to escalate into a thrown error.
  }
}

async function resolvePricing(
  input: ResolveEmailBlockRenderContextInput,
): Promise<PublicPricingProjection | null> {
  try {
    return await listPublicTicketsForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
    });
  } catch (error) {
    logResolutionError("pricing", input.eventId, error);
    return null;
  }
}

// Mirrors the public custom event page's own RegistrationEmbed resolution
// (src/app/events/[eventId]/page.tsx) exactly: hasPublishedForm + path
// counts -> resolveRegistrationCtaState -> "no_paths" collapses to null
// (the block's own "0 paths ever configured" fallback), "open"/"closed"
// carry through. The only divergence is `registerHref`, which must be an
// ABSOLUTE URL here (isEmailSafeUrl, see base-url.ts) rather than the site-
// relative path the web page can use directly.
async function resolveRegistrationCta(
  input: ResolveEmailBlockRenderContextInput & {
    event: { name: string; formPath: string };
  },
): Promise<EmailRegistrationCtaContext | null> {
  try {
    const [form, paths, baseUrl] = await Promise.all([
      getAdminPublishedFormForPublicEvent({
        eventId: input.eventId,
        eventName: input.event.name,
        organizationId: input.organizationId,
        formPath: input.event.formPath,
      }),
      getAdminRegistrationPathsForEvent({
        eventId: input.eventId,
        organizationId: input.organizationId,
      }),
      resolveEmailBaseUrl(),
    ]);

    const state = resolveRegistrationCtaState({
      hasPublishedForm: Boolean(form),
      totalPaths: paths.length,
      activePaths: paths.filter((path) => path.isActive).length,
    });

    // "no_paths" -> null (same convention as EventPageRegistrationCta):
    // RegistrationEmbed treats a null context identically to "never
    // configured", which is exactly what this state means.
    if (state === "no_paths") return null;

    // No resolvable absolute origin (NEXT_PUBLIC_APP_URL unset/invalid —
    // base-url.ts is deliberately env-var-only, never derived from
    // request headers, which are client-controlled input) -> the block
    // cannot render a safe <a href> for either "open" or "closed" wording
    // that depends on it; degrade to null (the block's zero-paths notice)
    // rather than emit a context whose href would fail isEmailSafeUrl
    // anyway.
    if (!baseUrl) return null;

    return {
      state,
      registerHref: `${baseUrl}/events/${input.eventId}/register`,
    };
  } catch (error) {
    logResolutionError("registrationCta", input.eventId, error);
    return null;
  }
}

// Pure — no I/O beyond the already-resolved event doc — but kept as its own
// function for symmetry/readability with the other two resolvers.
function resolveCountdown(event: {
  periods: Array<Record<string, string>>;
  timezone: string;
}): EmailCountdownContext {
  const eventStartMs = resolveEventStartMs(event);
  return {
    eventStartIso:
      eventStartMs !== null ? new Date(eventStartMs).toISOString() : null,
    timezone: resolveEventTimeZone(event.timezone),
  };
}

export async function resolveEmailBlockRenderContext(
  input: ResolveEmailBlockRenderContextInput,
): Promise<EmailBlockRenderContext> {
  try {
    const [event, pricing] = await Promise.all([
      getAdminEventForOrganization(input.eventId, input.organizationId).catch(
        (error: unknown) => {
          logResolutionError("event lookup", input.eventId, error);
          return null;
        },
      ),
      resolvePricing(input),
    ]);

    if (!event) {
      // Registration-CTA/countdown both need the event doc; pricing does
      // not, so it still resolves independently above.
      return { pricing, registrationCta: null, countdown: null };
    }

    const registrationCta = await resolveRegistrationCta({ ...input, event });
    const countdown = resolveCountdown(event);

    return { pricing, registrationCta, countdown };
  } catch (error) {
    // Belt-and-suspenders: every sub-resolution above already catches its
    // own errors, so this should be unreachable — but this function's
    // entire contract is "never throw", so one more outer guard costs
    // nothing and guarantees it.
    logResolutionError("block-render context", input.eventId, error);
    return EMPTY_EMAIL_BLOCK_RENDER_CONTEXT;
  }
}
