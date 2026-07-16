// @vitest-environment node
/**
 * QA-D-2 (was OPEN, Major — see agents/docs/qa/m6-email-designer.md) — spec
 * §6 AC-2: "The dark-mode meta tags are present in the assembled
 * document..." Spec §6's table (Dark mode row) states this explicitly and
 * normatively: "The email HTML must include
 * `<meta name="color-scheme" content="light">` and
 * `<meta name="supported-color-schemes" content="light">` in its document
 * wrapper... this carries forward M6-T2 §8-1's exact decision... into the
 * REAL SEND PATH, not just the preview."
 *
 * FIX (Full-Stack, this pass): `deriveBodyForDefinition` — the ONE
 * chokepoint every real send path (test-send, both real-time trigger hooks,
 * the periodic trigger runner, "Email all") and every preview surface
 * (the editor's live preview via `renderEmailDefinitionPreview`, the
 * confirmation-preview card) funnels through, for BOTH `bodyMode: "text"`
 * and `"blocks"` — now wraps its assembled `bodyHtml` fragment in a fixed,
 * code-authored HTML document shell (`wrapEmailBodyHtmlDocument`,
 * src/features/emails/server/render.ts) that declares both required
 * dark-mode opt-out meta tags, plus a `<body>`/outer `<table>` carrying both
 * the inline `background-color` CSS and the legacy `bgcolor=` attribute
 * (QA's secondary nit, same spec table row — Outlook's Word engine
 * sometimes ignores the CSS property but honors the attribute).
 *
 * The lower-level fragment producers (`deriveBodyHtmlFromBlocks`,
 * `deriveBodyHtmlTemplate`) deliberately stay BARE fragments — the wrap
 * happens one layer up, at `deriveBodyForDefinition`, which is the actual
 * "assembled document" the spec's AC-2 is about. `renderEmailTemplate`
 * (src/lib/email/merge-tags.ts) remains untouched (spec §3 AC-6's
 * hash-pinned tripwire) — the wrap happens on the TEMPLATE before
 * `renderEmailTemplate`'s merge-tag substitution pass runs on it, and the
 * wrapper's fixed markup contains no `{tag}` patterns, so substitution still
 * works correctly through the wrapped body (verified below).
 *
 * Following this loop's QA-D-1 (M6-T2) convention: the four previously
 * "PINNED" (bug-confirming) tests are now split — the two that exercised the
 * intentionally-still-bare fragment producers are UPDATED to document that
 * architecture decision (not deleted — the assertion they made, "these
 * specific functions return bare fragments," remains TRUE and correct after
 * the fix, it's just no longer evidence of a defect); the two that exercised
 * the actual "assembled document" functions are INVERTED into real,
 * asserting PASS tests. The three `it.todo` markers are promoted to real
 * tests.
 */
import { describe, expect, it } from "vitest";

import {
  deriveBodyForDefinition,
  deriveBodyHtmlFromBlocks,
  deriveBodyHtmlTemplate,
  renderEmailDefinitionPreview,
} from "@/features/emails/server/render";
import type { EmailPuckBlock } from "@/types/collection";

const heroBlock: EmailPuckBlock = {
  id: "hero-1",
  type: "Hero",
  props: {
    eyebrow: "Conference",
    heading: "Welcome",
    body: "Join us.",
    primaryCtaLabel: "",
    secondaryCtaLabel: "",
    imageUrl: "",
  },
};

describe("QA-D-2 (FIXED): dark-mode meta tags required by spec §6 AC-2 are present in the assembled document", () => {
  it("deriveBodyHtmlFromBlocks (a FRAGMENT producer, not the assembled document) intentionally stays bare — the wrap lives one layer up, in deriveBodyForDefinition", () => {
    const html = deriveBodyHtmlFromBlocks([heroBlock], {});
    expect(html).not.toContain("color-scheme");
    expect(html).not.toMatch(/<!DOCTYPE/i);
    expect(html).not.toMatch(/<head/i);
  });

  it("deriveBodyHtmlTemplate (text mode's FRAGMENT producer) also intentionally stays bare for the same reason", () => {
    const html = deriveBodyHtmlTemplate("Hello {first_name}, join us!");
    expect(html).not.toContain("color-scheme");
    expect(html).not.toMatch(/<!DOCTYPE/i);
  });

  it("deriveBodyForDefinition's output (the shape every real send path uses) includes BOTH required dark-mode meta tags, for either bodyMode", () => {
    const blockMode = deriveBodyForDefinition({
      body: "unused in block mode",
      bodyMode: "blocks",
      bodyBlocks: [heroBlock],
    });
    expect(blockMode.bodyHtml).toContain(
      '<meta name="color-scheme" content="light">',
    );
    expect(blockMode.bodyHtml).toContain(
      '<meta name="supported-color-schemes" content="light">',
    );
    expect(blockMode.bodyHtml).toMatch(/^<!DOCTYPE html>/i);
    // The block-mode fragment itself must still be present, verbatim,
    // inside the wrapper — wrapping must never drop or mangle content.
    expect(blockMode.bodyHtml).toContain("Welcome");

    const textMode = deriveBodyForDefinition({
      body: "Plain text body",
      bodyMode: "text",
    });
    expect(textMode.bodyHtml).toContain(
      '<meta name="color-scheme" content="light">',
    );
    expect(textMode.bodyHtml).toContain(
      '<meta name="supported-color-schemes" content="light">',
    );
    expect(textMode.bodyHtml).toContain("Plain text body");
  });

  it("renderEmailDefinitionPreview (the SAME function test-send/confirmation-card/every M6-T3 trigger calls) emits both required meta tags", () => {
    const result = renderEmailDefinitionPreview({
      subjectTemplate: "Hello {first_name}",
      bodyTemplate: "unused",
      context: { firstName: "Ada" },
      bodyMode: "blocks",
      bodyBlocks: [heroBlock],
    });
    expect(result.bodyHtml).toContain(
      '<meta name="color-scheme" content="light">',
    );
    expect(result.bodyHtml).toContain(
      '<meta name="supported-color-schemes" content="light">',
    );
  });

  it('block-mode bodyHtml includes <meta name="color-scheme" content="light"> and <meta name="supported-color-schemes" content="light">', () => {
    const result = deriveBodyForDefinition({
      body: "unused",
      bodyMode: "blocks",
      bodyBlocks: [heroBlock],
    });
    expect(result.bodyHtml).toContain(
      '<meta name="color-scheme" content="light">',
    );
    expect(result.bodyHtml).toContain(
      '<meta name="supported-color-schemes" content="light">',
    );
    // QA's secondary nit (same spec table row): legacy `bgcolor=` HTML
    // attribute present too, defense-in-depth for Outlook's Word engine.
    expect(result.bodyHtml).toMatch(/bgcolor="#[0-9a-f]{6}"/i);
  });

  it("text-mode bodyHtml includes both dark-mode meta tags too (spec §6's own framing is 'the real send path', not block-mode-only)", () => {
    const result = deriveBodyForDefinition({
      body: "Hello {first_name}, see you there!",
      bodyMode: "text",
    });
    expect(result.bodyHtml).toContain(
      '<meta name="color-scheme" content="light">',
    );
    expect(result.bodyHtml).toContain(
      '<meta name="supported-color-schemes" content="light">',
    );
    expect(result.bodyHtml).toMatch(/bgcolor="#[0-9a-f]{6}"/i);
  });

  it("the meta tags survive the full renderEmailDefinitionPreview pipeline (merge-tag substitution does not strip or corrupt them)", () => {
    const result = renderEmailDefinitionPreview({
      subjectTemplate: "Hi {first_name}",
      bodyTemplate: "Hello {first_name}, join us at {event_title}!",
      context: { firstName: "Ada", eventTitle: "Summit" },
      bodyMode: "text",
    });
    expect(result.bodyHtml).toContain(
      '<meta name="color-scheme" content="light">',
    );
    expect(result.bodyHtml).toContain(
      '<meta name="supported-color-schemes" content="light">',
    );
    // Merge-tag substitution itself still works correctly inside the
    // wrapped body — the wrapper's fixed markup contains no `{tag}`
    // patterns, so it neither breaks substitution nor gets substituted into.
    expect(result.bodyHtml).toContain("Hello Ada, join us at Summit!");
    expect(result.bodyHtml).not.toContain("{first_name}");
    expect(result.bodyHtml).not.toContain("{event_title}");
  });
});
