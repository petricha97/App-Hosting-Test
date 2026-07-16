// M6-T4 — Schedule block, email-safe render (spec §1 table: "Safe, as-is" —
// the web block is already a single static text block, heading + agenda,
// no grid, no interactivity). The only email-specific adjustment: the web
// block's `whitespace-pre-line` CSS class has no reliable Outlook
// equivalent, so newlines are converted to real `<br>` tags after escaping.
import "server-only";

import { emailBlockCard, EMAIL_BLOCK_COLORS } from "./styles";
import { escapedLongTextWithLineBreaks, escapedShortText } from "./text-utils";

export function renderScheduleBlockHtml(
  props: Record<string, unknown>,
): string {
  const title = escapedShortText(props.title);
  const agenda = escapedLongTextWithLineBreaks(props.agenda);

  const html =
    (title
      ? `<h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:${EMAIL_BLOCK_COLORS.heading};">${title}</h2>`
      : "") +
    (agenda
      ? `<p style="margin:0;font-size:14px;line-height:1.9;color:${EMAIL_BLOCK_COLORS.body};">${agenda}</p>`
      : "");

  return emailBlockCard(html);
}

export function scheduleBlockTextLines(
  props: Record<string, unknown>,
): string[] {
  const lines: string[] = [];
  const title = typeof props.title === "string" ? props.title.trim() : "";
  const agenda = typeof props.agenda === "string" ? props.agenda.trim() : "";
  if (title) lines.push(title);
  if (agenda) lines.push(agenda);
  return lines;
}
