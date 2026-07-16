// M6-T4 — fixed, code-authored inline styles ONLY. No block renderer in
// this directory may EVER build a `style="..."` attribute value from a
// free-text or URL prop (spec §3.1 step 2 / §3 AC-3 — asserted by a
// source-level test, src/__tests__/email-block-renderer-source-safety.test.ts,
// as well as the runtime XSS tests). This registry structurally has no
// free-text "style" prop anywhere — the only enum props that exist
// (`imageSide`, `target`) control rendering ORDER/LOGIC via plain `===`
// comparisons, never a style string — so there is nothing for an
// organizer-authored value to inject into a style attribute even in
// principle.
import "server-only";

export const EMAIL_BLOCK_COLORS = {
  heading: "#0f172a",
  body: "#475569",
  eyebrow: "#9a3412",
  border: "#e2e8f0",
  cardBg: "#f8fafc",
  sectionBg: "#ffffff",
  accentBg: "#ff7a59",
  accentText: "#ffffff",
  disabledBg: "#e2e8f0",
  disabledText: "#64748b",
  link: "#c2410c",
} as const;

// One outer table per block: width:100%, single <td> "card" with padding,
// background, and a border. Every block wraps its content in this exact
// skeleton so the assembled bodyHtml is a vertical stack of identical-shaped
// cards — this IS the "no side-by-side layout, ever" decision (spec §1)
// expressed structurally, not just as a rule callers must remember.
export function emailBlockCard(innerHtml: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 16px 0;">` +
    `<tr><td style="padding:24px;background-color:${EMAIL_BLOCK_COLORS.sectionBg};border:1px solid ${EMAIL_BLOCK_COLORS.border};border-radius:12px;">` +
    innerHtml +
    `</td></tr></table>`
  );
}
