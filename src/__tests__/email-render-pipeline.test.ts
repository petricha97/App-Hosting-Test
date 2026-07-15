// @vitest-environment node
/**
 * M6-T2 — the ONE email-definition render pipeline
 * (src/features/emails/server/render.ts). Spec §3 AC-3: "A body containing
 * <script>alert(1)</script> typed by the organizer renders as visible
 * literal text in the preview (escaped in derived bodyHtml — XSS test)."
 *
 * Locks:
 *  - deriveBodyHtmlTemplate HTML-escapes the whole template BEFORE merge-tag
 *    substitution — a literal <script> in the organizer's plain-text body
 *    arrives pre-escaped, so renderEmailTemplate never sees real markup;
 *  - {tag} braces SURVIVE the escape (so merge tags still substitute);
 *  - {qr_code} still expands to trusted markup in the HTML variant only;
 *  - plain-text bodyText is never escaped (verbatim template).
 */
import { describe, expect, it } from "vitest";

import {
  deriveBodyHtmlTemplate,
  renderEmailDefinitionPreview,
} from "@/features/emails/server/render";

describe("deriveBodyHtmlTemplate — XSS safety by construction (spec §3 AC-3)", () => {
  it("escapes a literal <script> tag typed by the organizer", () => {
    const html = deriveBodyHtmlTemplate(
      "Hello <script>alert(1)</script> world",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("wraps blank-line-separated blocks as paragraphs and single newlines as <br>", () => {
    const html = deriveBodyHtmlTemplate(
      "Line one\nLine two\n\nSecond paragraph",
    );
    expect(html).toBe("<p>Line one<br>Line two</p>\n<p>Second paragraph</p>");
  });

  it("leaves {tag} braces intact through the escape (tags still substitute)", () => {
    const html = deriveBodyHtmlTemplate("Hi {first_name}!");
    expect(html).toContain("{first_name}");
  });
});

describe("renderEmailDefinitionPreview — one pipeline for editor/card/test-send", () => {
  it("renders a <script> body as visible literal text, never executable markup", () => {
    const result = renderEmailDefinitionPreview({
      subjectTemplate: "Hi {first_name}",
      bodyTemplate: "<script>alert(1)</script> Dear {first_name},",
      context: { firstName: "Kenneth" },
    });

    expect(result.bodyHtml).not.toContain("<script>alert(1)</script>");
    expect(result.bodyHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result.bodyHtml).toContain("Kenneth");
    expect(result.subject).toBe("Hi Kenneth");
    // The plain-text variant is verbatim (never escaped) — matches T1's
    // "inserted verbatim into bodyText" rule.
    expect(result.bodyText).toContain("<script>alert(1)</script>");
  });

  it("{qr_code} expands to trusted markup in the HTML variant only, blank in plain text", () => {
    const result = renderEmailDefinitionPreview({
      subjectTemplate: "Your pass",
      bodyTemplate: "Your QR: {qr_code}",
      context: { qrCodeSvg: "<svg>trusted</svg>" },
    });

    expect(result.bodyHtml).toContain("<svg>trusted</svg>");
    expect(result.bodyText).not.toContain("<svg>trusted</svg>");
    expect(result.bodyText).not.toContain("{qr_code}");
  });

  it("reports unknown and missing tags for the editor's live warnings", () => {
    const result = renderEmailDefinitionPreview({
      subjectTemplate: "Hi {frist_name}",
      bodyTemplate: "Event: {event_date}",
      context: {},
    });

    expect(result.unknownTags).toContain("frist_name");
    expect(result.missingTags).toContain("event_date");
  });
});
