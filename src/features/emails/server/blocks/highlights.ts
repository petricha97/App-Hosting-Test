// M6-T4 — Highlights block, email-safe render (spec §1 table). The web
// block's 3-column grid becomes three consecutive stacked rows — no
// side-by-side layout, ever (spec §1 blanket rationale).
import "server-only";

import { emailBlockCard, EMAIL_BLOCK_COLORS } from "./styles";
import { escapedLongText, escapedShortText } from "./text-utils";

interface HighlightItem {
  title: string;
  body: string;
}

function resolveItems(props: Record<string, unknown>): HighlightItem[] {
  return [
    [props.itemOneTitle, props.itemOneBody],
    [props.itemTwoTitle, props.itemTwoBody],
    [props.itemThreeTitle, props.itemThreeBody],
  ]
    .map(([title, body]) => ({
      title: escapedShortText(title),
      body: escapedLongText(body),
    }))
    .filter((item) => item.title.length > 0 || item.body.length > 0);
}

export function renderHighlightsBlockHtml(
  props: Record<string, unknown>,
): string {
  const title = escapedShortText(props.title);
  const intro = escapedLongText(props.intro);
  const items = resolveItems(props);

  const headHtml =
    (title
      ? `<h2 style="margin:0 0 8px 0;font-size:20px;font-weight:700;color:${EMAIL_BLOCK_COLORS.heading};">${title}</h2>`
      : "") +
    (intro
      ? `<p style="margin:0;font-size:14px;line-height:1.7;color:${EMAIL_BLOCK_COLORS.body};">${intro}</p>`
      : "");

  const rowsHtml = items
    .map(
      (item) =>
        `<tr><td style="padding:14px 0;border-top:1px solid ${EMAIL_BLOCK_COLORS.border};">` +
        (item.title
          ? `<p style="margin:0 0 4px 0;font-size:15px;font-weight:700;color:${EMAIL_BLOCK_COLORS.heading};">${item.title}</p>`
          : "") +
        (item.body
          ? `<p style="margin:0;font-size:14px;line-height:1.7;color:${EMAIL_BLOCK_COLORS.body};">${item.body}</p>`
          : "") +
        `</td></tr>`,
    )
    .join("");

  const itemsHtml = rowsHtml
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:12px;">${rowsHtml}</table>`
    : "";

  return emailBlockCard(`${headHtml}${itemsHtml}`);
}

export function highlightsBlockTextLines(
  props: Record<string, unknown>,
): string[] {
  const lines: string[] = [];
  const title = typeof props.title === "string" ? props.title.trim() : "";
  const intro = typeof props.intro === "string" ? props.intro.trim() : "";
  if (title) lines.push(title);
  if (intro) lines.push(intro);
  for (const [rawTitle, rawBody] of [
    [props.itemOneTitle, props.itemOneBody],
    [props.itemTwoTitle, props.itemTwoBody],
    [props.itemThreeTitle, props.itemThreeBody],
  ]) {
    const itemTitle = typeof rawTitle === "string" ? rawTitle.trim() : "";
    const itemBody = typeof rawBody === "string" ? rawBody.trim() : "";
    if (itemTitle) lines.push(itemTitle);
    if (itemBody) lines.push(itemBody);
  }
  return lines;
}
