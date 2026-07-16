// M6-T4 — Hero block, email-safe render (spec §1 table). Single-column
// (no `lg:grid-cols-[1.15fr_0.85fr]` split), no CSS gradient background
// (Outlook/Word engine does not render one — solid `sectionBg` instead, via
// emailBlockCard), and — the one prop-level divergence from the web
// block — `primaryCtaLabel`/`secondaryCtaLabel` are NEVER rendered here
// (spec §1 AC-3): they stay in storage for round-trip consistency only.
import "server-only";

import { emailBlockCard, EMAIL_BLOCK_COLORS } from "./styles";
import { escapedLongText, escapedShortText } from "./text-utils";
import { safeImageUrl } from "./image-utils";

export function renderHeroBlockHtml(props: Record<string, unknown>): string {
  const eyebrow = escapedShortText(props.eyebrow);
  const heading = escapedLongText(props.heading);
  const body = escapedLongText(props.body);
  // primaryCtaLabel / secondaryCtaLabel are DELIBERATELY never read here —
  // see the file header. Confirmed absent from this render function by the
  // dedicated CTA-omission test (spec §1 AC-3).
  const imageSrc = safeImageUrl(props.imageUrl);

  const textHtml =
    (eyebrow
      ? `<p style="margin:0 0 8px 0;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_BLOCK_COLORS.eyebrow};">${eyebrow}</p>`
      : "") +
    (heading
      ? `<h1 style="margin:0 0 12px 0;font-size:26px;line-height:1.3;font-weight:700;color:${EMAIL_BLOCK_COLORS.heading};">${heading}</h1>`
      : "") +
    (body
      ? `<p style="margin:0;font-size:15px;line-height:1.7;color:${EMAIL_BLOCK_COLORS.body};">${body}</p>`
      : "");

  const altText = heading || "Event image";
  const imageHtml = imageSrc
    ? `<img src="${imageSrc}" alt="${altText}" width="100%" style="display:block;width:100%;max-width:520px;height:auto;border-radius:8px;margin:16px 0 0 0;" />`
    : "";

  return emailBlockCard(`${textHtml}${imageHtml}`);
}

// Plain-text derivation (spec §3.3): heading, then body, in reading order.
// Eyebrow is a short lead-in label, included first when present. CTA labels
// are excluded here too (they render nowhere in email — text mode included).
export function heroBlockTextLines(props: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const eyebrow = typeof props.eyebrow === "string" ? props.eyebrow.trim() : "";
  const heading = typeof props.heading === "string" ? props.heading.trim() : "";
  const body = typeof props.body === "string" ? props.body.trim() : "";
  if (eyebrow) lines.push(eyebrow);
  if (heading) lines.push(heading);
  if (body) lines.push(body);
  return lines;
}
