// The ONE email-definition render pipeline (design §3 "one preview
// implementation, not two", carried through §4/§5 read-only reuse). Spec
// Shared decisions: "T2 compose is plain text + merge tags... bodyHtml is
// derived deterministically (HTML-escape, then paragraph/<br> wrapping —
// {tag} braces survive escaping, so {qr_code} still expands to the trusted
// server-minted SVG in the HTML variant only)."
//
// This is the SAME derivation the editor's live preview (§3), the
// confirmation card (§4), and test-send (§5) all funnel through — no
// organizer-authored raw HTML exists anywhere in T2, which is what makes the
// <script> case (§3 AC-3) safe BY CONSTRUCTION: the escape happens on the
// TEMPLATE (including any literal HTML an organizer types), before merge
// tags are substituted.
import "server-only";

import {
  escapeHtml,
  renderEmailTemplate,
  type EmailMergeContext,
  type RenderEmailTemplateResult,
} from "@/lib/email/merge-tags";
import {
  isEmailSafeBlockType,
  renderEmailBlockHtml,
  renderEmailBlockTextLines,
  type EmailBlockRenderContext,
} from "@/features/emails/server/blocks";
import { EMAIL_BLOCK_COLORS } from "@/features/emails/server/blocks/styles";
import type { EmailPuckBlock } from "@/types/collection";

export type { EmailBlockRenderContext } from "@/features/emails/server/blocks";

// M6-T4 — Puck block data -> email-safe HTML (spec §3, the security-critical
// core of this ticket). Runs, PER BLOCK, in this fixed order (spec §3.1):
//   1. type-allowlist check (isEmailSafeBlockType) — an unknown/removed
//      type is SKIPPED, never an error, never rendered raw (spec §1 AC-8);
//   2/3. per-prop schema + contextual output encoding — delegated to the
//      per-type renderer functions in ./blocks, each of which re-runs its
//      own escaping/URL-validation controls independently of whatever the
//      write-time Zod schema already enforced (defense in depth for data
//      that predates a registry/schema change);
//   4. assembly into one bodyHtml template string — this function's return
//      value — fed into the SAME, UNMODIFIED renderEmailTemplate merge-tag
//      pass every other path already uses (see
//      renderEmailDefinitionPreview below);
//   5. no renderer in ./blocks ever emits <script>/<iframe>/<object>/
//      <embed>/<form>/<style> or an on*= handler — by construction (a
//      fixed, finite, reviewed set of template functions), not by
//      filtering.
export function deriveBodyHtmlFromBlocks(
  bodyBlocks: EmailPuckBlock[],
  context: EmailBlockRenderContext = {},
): string {
  return bodyBlocks
    .filter((block) => isEmailSafeBlockType(block.type))
    .map((block) => renderEmailBlockHtml(block, context))
    .filter((html): html is string => typeof html === "string")
    .join("\n");
}

// Plain-text sibling (spec §3.3): walks the block PROPS directly (never the
// rendered HTML — a naive strip-tags-after-render approach would leave
// leftover entities like `&amp;` and is explicitly rejected by spec §3 AC-7)
// to build the bodyText alternative. Each block contributes its own
// newline-joined line group; blocks are separated by a blank line; an
// unknown-type or genuinely empty block (e.g. an image-only Hero with no
// heading/body) contributes nothing — never a broken empty line.
export function deriveBodyTextFromBlocks(
  bodyBlocks: EmailPuckBlock[],
  context: EmailBlockRenderContext = {},
): string {
  return bodyBlocks
    .filter((block) => isEmailSafeBlockType(block.type))
    .map((block) => renderEmailBlockTextLines(block, context).join("\n"))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

// Escapes the whole plain-text template, then wraps it as paragraphs/<br> —
// blank-line-separated blocks become <p>, single newlines become <br>.
// `{tag}` tokens survive `escapeHtml` unchanged (lowercase letters/digits/
// underscore/braces are not in its replacement set), so renderEmailTemplate
// can still find and substitute them afterward.
export function deriveBodyHtmlTemplate(bodyText: string): string {
  const escaped = escapeHtml(bodyText);
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`);
  return paragraphs.join("\n");
}

// M6-T4 QA-D-2 fix (spec §6 AC-2): wraps an assembled bodyHtml FRAGMENT
// (block-mode's <table> stack, or text-mode's <p> stack) in a minimal,
// fixed, code-authored HTML document shell — <!DOCTYPE>/<html>/<head> with
// the two client-side dark-mode opt-out meta tags Apple Mail/iOS Mail need
// so their automatic dark-mode re-coloring does not invert every block's
// hard-coded light styling (every block renderer hard-codes
// EMAIL_BLOCK_COLORS.* light colors with no other opt-out declared). The
// `<body>`/outer `<table>` carry BOTH the inline `background-color` CSS and
// the legacy `bgcolor=` HTML attribute (spec §6's same table row, QA's
// secondary nit) — Outlook's Word rendering engine sometimes ignores the
// CSS property but honors the attribute. The background reuses
// `EMAIL_BLOCK_COLORS.sectionBg` — the SAME color every block card already
// renders itself against (styles.ts `emailBlockCard`) — not a new/invented
// color.
//
// This is a FIXED wrapper string with no organizer-influenced interpolation
// point (the only variable is the already fully-derived `bodyHtmlFragment`
// itself, inserted verbatim — it was already escaped/assembled by its own
// producer, e.g. deriveBodyHtmlFromBlocks/deriveBodyHtmlTemplate). Applied
// ONLY at the deriveBodyForDefinition chokepoint (below) — never inside
// deriveBodyHtmlFromBlocks/deriveBodyHtmlTemplate themselves, which stay
// bare fragments by design (they are composed together, or reused
// standalone by callers that assemble their own document, e.g. a future
// multi-fragment digest) — and deliberately NOT inside
// merge-tags.ts/renderEmailTemplate (spec §3 AC-6's hash-pinned tripwire
// forbids touching that function). Both authoring modes (`bodyMode: "text"`
// and `"blocks"`) funnel through this same wrap, so every real send path
// and the editor's own preview inherit it with this single call-site
// change.
function wrapEmailBodyHtmlDocument(bodyHtmlFragment: string): string {
  const bg = EMAIL_BLOCK_COLORS.sectionBg;
  return (
    `<!DOCTYPE html>` +
    `<html lang="en">` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="light">` +
    `<meta name="supported-color-schemes" content="light">` +
    `</head>` +
    `<body style="margin:0;padding:0;background-color:${bg};" bgcolor="${bg}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="width:100%;background-color:${bg};">` +
    `<tr><td>` +
    bodyHtmlFragment +
    `</td></tr>` +
    `</table>` +
    `</body>` +
    `</html>`
  );
}

// M6-T4 — the ONE place `bodyMode` is branched on (Shared decisions:
// "T4 adds exactly one internal branch"). Extracted as its own function so
// every consumer of a definition's body — not just the editor-preview path
// below — can adopt block-mode with a single call-site change, rather than
// each M6-T3 trigger/test-send/bulk-send call site re-implementing this
// same `bodyMode === "blocks" ? ... : ...` branch by hand (which would be
// exactly the kind of "parallel send pipeline" duplication the spec's
// Shared decisions explicitly rules out). `bodyMode`/`bodyBlocks` are
// OPTIONAL — a definition shape that omits them (every pre-T4 caller,
// including a plain `{ body }` object) renders IDENTICALLY to the pre-T4
// `deriveBodyHtmlTemplate(body)` / `body` pair.
export function deriveBodyForDefinition(
  definition: {
    body: string;
    bodyMode?: "text" | "blocks";
    bodyBlocks?: EmailPuckBlock[];
  },
  blockContext?: EmailBlockRenderContext,
): { bodyHtml: string; bodyText: string } {
  if (definition.bodyMode === "blocks") {
    return {
      bodyHtml: wrapEmailBodyHtmlDocument(
        deriveBodyHtmlFromBlocks(definition.bodyBlocks ?? [], blockContext),
      ),
      bodyText: deriveBodyTextFromBlocks(
        definition.bodyBlocks ?? [],
        blockContext,
      ),
    };
  }
  return {
    bodyHtml: wrapEmailBodyHtmlDocument(
      deriveBodyHtmlTemplate(definition.body),
    ),
    bodyText: definition.body,
  };
}

// `renderEmailTemplate` itself is NOT touched by this ticket (spec §3
// AC-6) — both branches funnel into the exact same, unmodified call at the
// bottom of this function.
export function renderEmailDefinitionPreview(input: {
  subjectTemplate: string;
  bodyTemplate: string;
  context: EmailMergeContext;
  bodyMode?: "text" | "blocks";
  bodyBlocks?: EmailPuckBlock[];
  blockContext?: EmailBlockRenderContext;
}): RenderEmailTemplateResult {
  const { bodyHtml, bodyText } = deriveBodyForDefinition(
    {
      body: input.bodyTemplate,
      bodyMode: input.bodyMode,
      bodyBlocks: input.bodyBlocks,
    },
    input.blockContext,
  );

  return renderEmailTemplate(
    {
      subject: input.subjectTemplate,
      bodyHtml,
      bodyText,
    },
    input.context,
  );
}
