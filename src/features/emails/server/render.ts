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

export function renderEmailDefinitionPreview(input: {
  subjectTemplate: string;
  bodyTemplate: string;
  context: EmailMergeContext;
}): RenderEmailTemplateResult {
  return renderEmailTemplate(
    {
      subject: input.subjectTemplate,
      bodyHtml: deriveBodyHtmlTemplate(input.bodyTemplate),
      bodyText: input.bodyTemplate,
    },
    input.context,
  );
}
