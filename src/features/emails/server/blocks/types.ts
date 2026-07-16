// M6-T4 — contextual data three of the 8 email-safe block renderers need
// BEYOND their own stored `props` (RegistrationEmbed/TicketPricingTable/
// CountdownTimer). This is the email equivalent of `createEventPagePuckConfig`'s
// injected `pricingTickets`/`countdown`/`registrationCta` options on the web
// builder (src/features/event-pages/puck.tsx) — SAME data shape family,
// deliberately re-declared here (not imported from that "use client" module)
// so this server-only, security-critical render path never depends on a
// client-bundle file.
//
// Every slice is optional/nullable end-to-end: a caller that has not (yet)
// wired live data for a given render never crashes — the corresponding
// block renders its honest, non-crashing fallback state instead (spec §1's
// per-block table: RegistrationEmbed's "0 paths ever configured" notice,
// TicketPricingTable's empty state, CountdownTimer's completedMessage).
import "server-only";

import type { PublicPricingProjection } from "@/features/public-registration/types";

// null/absent state is `registrationCta === undefined | null` at the
// `EmailBlockRenderContext` level (see below) — modeled as an OPTIONAL,
// NULLABLE field rather than a third union member so the "zero paths ever
// configured" branch (spec §1) is the natural "caller has nothing to tell us
// about registration" default, matching
// `src/features/event-pages/puck.tsx`'s `EventPageRegistrationCta | null`
// convention exactly (null there means the same thing: no paths ever).
export interface EmailRegistrationCtaContext {
  state: "open" | "closed";
  // Absolute URL to the public register flow — re-validated against the
  // SAME URL-scheme allowlist as every other URL-typed value in this
  // registry (spec §3.1 step 2) before ever reaching an `href` attribute;
  // an unsafe value here degrades to the closed/disabled rendering rather
  // than being trusted blindly (defense in depth: this context object is
  // caller-supplied, not organizer-authored, but "never trust it blindly"
  // is the same posture applied to every other input in this module).
  registerHref: string;
}

export interface EmailCountdownContext {
  // Full "Z" ISO string or null (mirrors EventPageCountdownData). null = no
  // usable event start to derive a target from.
  eventStartIso: string | null;
  timezone: string;
}

export interface EmailBlockRenderContext {
  // TicketPricingTable — spec §1 AC-9's explicit freshness divergence: this
  // is a SNAPSHOT the caller resolved at render/send time (unlike the public
  // web page's live re-fetch-per-request behavior) — this module never
  // fetches, it only places whatever projection it is handed.
  pricing?: PublicPricingProjection | null;
  registrationCta?: EmailRegistrationCtaContext | null;
  countdown?: EmailCountdownContext | null;
}

export const EMPTY_EMAIL_BLOCK_RENDER_CONTEXT: EmailBlockRenderContext = {};
