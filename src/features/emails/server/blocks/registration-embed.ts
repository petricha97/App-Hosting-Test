// M6-T4 — RegistrationEmbed block, email-safe render (spec §1 table, three
// branches, one branch EXCLUDED):
//   - "open" (>=1 active path): a real, absolute-URL bulletproof button.
//   - "closed" (paths exist but none active, or form unpublished): static
//     disabled-styled text, matching the web's existing state semantics.
//   - "0 paths ever configured": the legacy inline-form branch is EXCLUDED
//     from email (an inline <form> cannot function in a mail client and is
//     commonly stripped/flagged as phishing) — replaced with a static
//     notice pointing at the {event_url} merge tag.
//
// `context` is caller-supplied (src/features/emails/server/blocks/types.ts)
// — undefined/null is treated identically to "0 paths ever configured"
// (never a crash, never a broken form; spec §1 AC-5 / AC-8's "never a hidden
// block" spirit extended to a missing-context caller).
import "server-only";

import { escapeHtml } from "@/lib/email/merge-tags";

import type { EmailRegistrationCtaContext } from "./types";
import { emailBlockCard, EMAIL_BLOCK_COLORS } from "./styles";
import { escapedLongText, escapedShortText } from "./text-utils";
import { isEmailSafeUrl } from "./url-validator";

const DEFAULT_BUTTON_LABEL = "Register now";
const ZERO_PATHS_NOTICE =
  "Registration isn't set up on this page yet. Visit the event page for updates:";
const CLOSED_NOTICE = "Registration is currently closed. Check back soon.";

function introHtml(props: Record<string, unknown>): string {
  const title = escapedShortText(props.title);
  const body = escapedLongText(props.body);
  return (
    (title
      ? `<h2 style="margin:0 0 8px 0;font-size:20px;font-weight:700;color:${EMAIL_BLOCK_COLORS.heading};">${title}</h2>`
      : "") +
    (body
      ? `<p style="margin:0;font-size:14px;line-height:1.7;color:${EMAIL_BLOCK_COLORS.body};">${body}</p>`
      : "")
  );
}

function resolveButtonLabel(props: Record<string, unknown>): string {
  const label = escapedShortText(props.buttonLabel);
  return label.length > 0 ? label : DEFAULT_BUTTON_LABEL;
}

export function renderRegistrationEmbedBlockHtml(
  props: Record<string, unknown>,
  context: EmailRegistrationCtaContext | null | undefined,
): string {
  const head = introHtml(props);
  const buttonLabel = resolveButtonLabel(props);

  if (context && context.state === "open") {
    const rawHref =
      typeof context.registerHref === "string"
        ? context.registerHref.trim()
        : "";
    // URL-scheme control re-run at render time (spec §3.1 step 2) even
    // though `registerHref` is caller-supplied, not organizer-typed — never
    // trust an input blindly. An unsafe href falls through to the closed
    // rendering below rather than ever reaching an <a href>.
    if (isEmailSafeUrl(rawHref)) {
      const safeHref = escapeHtml(rawHref);
      const buttonHtml =
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;border-collapse:collapse;">` +
        `<tr><td style="background-color:${EMAIL_BLOCK_COLORS.accentBg};border-radius:999px;">` +
        `<a href="${safeHref}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:700;color:${EMAIL_BLOCK_COLORS.accentText};text-decoration:none;border-radius:999px;">${buttonLabel}</a>` +
        `</td></tr></table>`;
      return emailBlockCard(`${head}${buttonHtml}`);
    }
  }

  if (context && context.state === "closed") {
    const disabledHtml =
      `<span style="display:inline-block;margin-top:16px;padding:12px 28px;font-size:14px;font-weight:700;color:${EMAIL_BLOCK_COLORS.disabledText};background-color:${EMAIL_BLOCK_COLORS.disabledBg};border-radius:999px;">${buttonLabel}</span>` +
      `<p style="margin:12px 0 0 0;font-size:13px;line-height:1.6;color:${EMAIL_BLOCK_COLORS.body};">${CLOSED_NOTICE}</p>`;
    return emailBlockCard(`${head}${disabledHtml}`);
  }

  // context null/undefined, OR an "open" context whose href failed
  // validation (defensive fallback): the event has never configured
  // registration paths — render the static notice with a CODE-AUTHORED
  // `{event_url}` merge-tag literal (NOT organizer input, safe to embed
  // unescaped) rather than the excluded legacy inline-form branch. The
  // shared merge-tag pass — run by the CALLER after this module assembles
  // the full bodyHtml — substitutes it exactly like every other `{tag}`
  // that already survives escapeHtml by construction (spec §3.1 step 4).
  const zeroPathsHtml =
    `<p style="margin-top:16px;font-size:13px;line-height:1.6;color:${EMAIL_BLOCK_COLORS.body};">` +
    `${ZERO_PATHS_NOTICE} <a href="{event_url}" style="color:${EMAIL_BLOCK_COLORS.link};text-decoration:underline;">{event_url}</a>` +
    `</p>`;
  return emailBlockCard(`${head}${zeroPathsHtml}`);
}

export function registrationEmbedBlockTextLines(
  props: Record<string, unknown>,
  context: EmailRegistrationCtaContext | null | undefined,
): string[] {
  const lines: string[] = [];
  const title = typeof props.title === "string" ? props.title.trim() : "";
  const body = typeof props.body === "string" ? props.body.trim() : "";
  if (title) lines.push(title);
  if (body) lines.push(body);

  const buttonLabelRaw =
    typeof props.buttonLabel === "string" ? props.buttonLabel.trim() : "";
  const buttonLabel =
    buttonLabelRaw.length > 0 ? buttonLabelRaw : DEFAULT_BUTTON_LABEL;

  if (context && context.state === "open") {
    const href =
      typeof context.registerHref === "string"
        ? context.registerHref.trim()
        : "";
    if (isEmailSafeUrl(href)) {
      lines.push(`${buttonLabel}: ${href}`);
      return lines;
    }
  }

  if (context && context.state === "closed") {
    lines.push(CLOSED_NOTICE);
    return lines;
  }

  lines.push(`${ZERO_PATHS_NOTICE} {event_url}`);
  return lines;
}
