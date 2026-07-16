// M6-T4 — CountdownTimer block, email-safe render (spec §1 table). There is
// no JavaScript in any email client — the four ticking unit tiles the web
// block renders CANNOT exist here. This renders the RESOLVED ABSOLUTE target
// date/time only, generated once at render/send time (or `completedMessage`
// if the target has already passed) — an honest, deliberately reduced
// feature, never a fake countdown that would silently go stale.
//
// Reuses the web block's OWN pure target-resolution/formatting functions
// (src/features/event-pages/countdown.ts — no "use client" directive, plain
// TS module) rather than reimplementing date math a second time.
import "server-only";

import {
  formatCountdownTarget,
  resolveCountdownTargetMs,
} from "@/features/event-pages/countdown";
import { escapeHtml } from "@/lib/email/merge-tags";

import type { EmailCountdownContext } from "./types";
import { emailBlockCard, EMAIL_BLOCK_COLORS } from "./styles";
import { escapedShortText } from "./text-utils";

const DEFAULT_COMPLETED_MESSAGE = "The event has started.";
const DEFAULT_TIMEZONE = "UTC";

function resolveTarget(
  props: Record<string, unknown>,
  countdown: EmailCountdownContext | null | undefined,
): { targetMs: number | null; timezone: string } {
  const target = props.target === "custom" ? "custom" : "eventStart";
  const customDateTime =
    typeof props.customDateTime === "string" ? props.customDateTime : "";
  const timezone =
    typeof countdown?.timezone === "string" && countdown.timezone.length > 0
      ? countdown.timezone
      : DEFAULT_TIMEZONE;

  const targetMs = resolveCountdownTargetMs({
    target,
    customDateTime,
    eventStartIso: countdown?.eventStartIso ?? null,
    timezone,
  });

  return { targetMs, timezone };
}

function resolveCompletedMessage(props: Record<string, unknown>): string {
  const message = escapedShortText(props.completedMessage);
  return message.length > 0 ? message : DEFAULT_COMPLETED_MESSAGE;
}

export function renderCountdownTimerBlockHtml(
  props: Record<string, unknown>,
  countdown: EmailCountdownContext | null | undefined,
  nowMs: number = Date.now(),
): string {
  const title = escapedShortText(props.title);
  const { targetMs, timezone } = resolveTarget(props, countdown);
  const completedMessage = resolveCompletedMessage(props);

  // Past/unresolvable target -> completedMessage; never negative digits,
  // never ticking tiles (spec §1 AC-7).
  const bodyText =
    targetMs === null || targetMs <= nowMs
      ? completedMessage
      : escapeHtml(formatCountdownTarget(targetMs, timezone));

  const headHtml = title
    ? `<p style="margin:0 0 8px 0;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_BLOCK_COLORS.eyebrow};">${title}</p>`
    : "";

  const bodyHtml = `<p style="margin:0;font-size:22px;font-weight:700;color:${EMAIL_BLOCK_COLORS.heading};text-align:center;">${bodyText}</p>`;

  return emailBlockCard(`${headHtml}${bodyHtml}`);
}

export function countdownTimerBlockTextLines(
  props: Record<string, unknown>,
  countdown: EmailCountdownContext | null | undefined,
  nowMs: number = Date.now(),
): string[] {
  const lines: string[] = [];
  const title = typeof props.title === "string" ? props.title.trim() : "";
  if (title) lines.push(title);

  const { targetMs, timezone } = resolveTarget(props, countdown);
  const completedRaw =
    typeof props.completedMessage === "string"
      ? props.completedMessage.trim()
      : "";
  const completedMessage =
    completedRaw.length > 0 ? completedRaw : DEFAULT_COMPLETED_MESSAGE;

  lines.push(
    targetMs === null || targetMs <= nowMs
      ? completedMessage
      : formatCountdownTarget(targetMs, timezone),
  );
  return lines;
}
