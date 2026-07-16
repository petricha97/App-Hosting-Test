// M6-T4 — Story block, email-safe render (spec §1 table). Image+text
// side-by-side becomes stacked; `imageSide` still meaningfully controls
// reading ORDER in the single column (spec §1 AC-4): "left" -> image, then
// text; "right" -> text, then image. `imageSide` is an ENUM read via a plain
// `===` comparison — never interpolated into a style/class string (spec
// §3.1 step 2 / §3 AC-3).
import "server-only";

import { emailBlockCard, EMAIL_BLOCK_COLORS } from "./styles";
import { escapedLongText, escapedShortText } from "./text-utils";
import { safeImageUrl } from "./image-utils";

export function renderStoryBlockHtml(props: Record<string, unknown>): string {
  const title = escapedShortText(props.title);
  const body = escapedLongText(props.body);
  const imageSrc = safeImageUrl(props.imageUrl);
  const imageSide = props.imageSide === "left" ? "left" : "right";

  const textHtml =
    (title
      ? `<h2 style="margin:0 0 8px 0;font-size:20px;font-weight:700;color:${EMAIL_BLOCK_COLORS.heading};">${title}</h2>`
      : "") +
    (body
      ? `<p style="margin:0;font-size:15px;line-height:1.7;color:${EMAIL_BLOCK_COLORS.body};">${body}</p>`
      : "");

  const altText = title || "Story image";
  const imageHtml = imageSrc
    ? `<img src="${imageSrc}" alt="${altText}" width="100%" style="display:block;width:100%;max-width:520px;height:auto;border-radius:8px;margin:0 0 16px 0;" />`
    : "";

  const orderedHtml =
    imageSide === "left"
      ? `${imageHtml}${textHtml}`
      : `${textHtml}${imageHtml}`;

  return emailBlockCard(orderedHtml);
}

export function storyBlockTextLines(props: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const title = typeof props.title === "string" ? props.title.trim() : "";
  const body = typeof props.body === "string" ? props.body.trim() : "";
  if (title) lines.push(title);
  if (body) lines.push(body);
  return lines;
}
