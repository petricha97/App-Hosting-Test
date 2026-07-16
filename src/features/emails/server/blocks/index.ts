// M6-T4 — the block-type allowlist dispatch (spec §3.1 step 1: "Type
// allowlist check... re-checked at render time even though write-time
// validation already enforced it, because stored data can predate a
// registry change"). This is the ONLY place block.type is switched on to
// pick a renderer — every branch is a fixed, finite, reviewed, server-only
// template function (spec §3.1 step 5); there is no "default: render raw
// props" branch anywhere in this module.
import "server-only";

import { EMAIL_SAFE_BLOCK_TYPES } from "@/types/collection";
import type { EmailPuckBlock, EmailSafeBlockType } from "@/types/collection";

import {
  renderCountdownTimerBlockHtml,
  countdownTimerBlockTextLines,
} from "./countdown-timer";
import { renderFaqBlockHtml, faqBlockTextLines } from "./faq";
import { renderHeroBlockHtml, heroBlockTextLines } from "./hero";
import {
  renderHighlightsBlockHtml,
  highlightsBlockTextLines,
} from "./highlights";
import {
  renderRegistrationEmbedBlockHtml,
  registrationEmbedBlockTextLines,
} from "./registration-embed";
import { renderScheduleBlockHtml, scheduleBlockTextLines } from "./schedule";
import { renderStoryBlockHtml, storyBlockTextLines } from "./story";
import {
  renderTicketPricingTableBlockHtml,
  ticketPricingTableBlockTextLines,
} from "./ticket-pricing-table";
import type { EmailBlockRenderContext } from "./types";
import { EMPTY_EMAIL_BLOCK_RENDER_CONTEXT } from "./types";

export { EMAIL_SAFE_BLOCK_TYPES } from "@/types/collection";
export type {
  EmailBlockRenderContext,
  EmailCountdownContext,
  EmailRegistrationCtaContext,
} from "./types";
export { EMPTY_EMAIL_BLOCK_RENDER_CONTEXT } from "./types";

const EMAIL_SAFE_BLOCK_TYPE_SET: ReadonlySet<string> = new Set(
  EMAIL_SAFE_BLOCK_TYPES,
);

// Control #1 (spec §3.1 step 1) as a standalone, directly-testable
// predicate — the SAME allowlist backs both the write-time Zod
// discriminated union (src/lib/email/schemas.ts) and this render-time
// re-check; never a second, hand-duplicated list.
export function isEmailSafeBlockType(
  type: unknown,
): type is EmailSafeBlockType {
  return typeof type === "string" && EMAIL_SAFE_BLOCK_TYPE_SET.has(type);
}

function resolveProps(block: EmailPuckBlock): Record<string, unknown> {
  return block.props && typeof block.props === "object" ? block.props : {};
}

// Returns null for a block whose type is not currently allowlisted — the
// CALLER (deriveBodyHtmlFromBlocks) skips it, never renders raw props, never
// throws (spec §1 AC-8).
export function renderEmailBlockHtml(
  block: EmailPuckBlock,
  context: EmailBlockRenderContext = EMPTY_EMAIL_BLOCK_RENDER_CONTEXT,
): string | null {
  const props = resolveProps(block);
  switch (block.type) {
    case "Hero":
      return renderHeroBlockHtml(props);
    case "Highlights":
      return renderHighlightsBlockHtml(props);
    case "Story":
      return renderStoryBlockHtml(props);
    case "Schedule":
      return renderScheduleBlockHtml(props);
    case "Faq":
      return renderFaqBlockHtml(props);
    case "RegistrationEmbed":
      return renderRegistrationEmbedBlockHtml(props, context.registrationCta);
    case "TicketPricingTable":
      return renderTicketPricingTableBlockHtml(props, context.pricing);
    case "CountdownTimer":
      return renderCountdownTimerBlockHtml(props, context.countdown);
    default:
      // Unreachable when the caller already gated on isEmailSafeBlockType —
      // kept as an explicit, non-throwing fallback rather than trusting
      // that gate blindly (defense in depth, mirrors the rest of this
      // module's "never assume, always re-check" posture).
      return null;
  }
}

// Plain-text sibling (spec §3.3): returns this block's own non-empty lines
// in reading order, or [] for an unknown type / a block with no text-bearing
// content at all (an image-only Hero, for instance) — the caller joins
// non-empty per-block line groups with blank lines between blocks.
export function renderEmailBlockTextLines(
  block: EmailPuckBlock,
  context: EmailBlockRenderContext = EMPTY_EMAIL_BLOCK_RENDER_CONTEXT,
): string[] {
  const props = resolveProps(block);
  switch (block.type) {
    case "Hero":
      return heroBlockTextLines(props);
    case "Highlights":
      return highlightsBlockTextLines(props);
    case "Story":
      return storyBlockTextLines(props);
    case "Schedule":
      return scheduleBlockTextLines(props);
    case "Faq":
      return faqBlockTextLines(props);
    case "RegistrationEmbed":
      return registrationEmbedBlockTextLines(props, context.registrationCta);
    case "TicketPricingTable":
      return ticketPricingTableBlockTextLines(props);
    case "CountdownTimer":
      return countdownTimerBlockTextLines(props, context.countdown);
    default:
      return [];
  }
}
