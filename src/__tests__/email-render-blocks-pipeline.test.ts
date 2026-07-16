// @vitest-environment node
/**
 * M6-T4 — the block-mode render pipeline (src/features/emails/server/
 * render.ts: deriveBodyHtmlFromBlocks / deriveBodyTextFromBlocks / the
 * bodyMode branch in renderEmailDefinitionPreview). Spec
 * agents/docs/specs/m6-email-designer.md §3.
 *
 * Locks:
 *  - §1 AC-8 / §3.1 step 1: a block whose type is not in the allowlist is
 *    SKIPPED, never crashes, never renders raw props;
 *  - §3 AC-4: a maximal (20-block) REALISTIC fixture stays under the
 *    existing 256 KB validateRenderedEmailContent cap; a deliberately
 *    pathological all-maxed fixture is allowed to legitimately fail it —
 *    the cap itself is NOT raised for block mode;
 *  - §3 AC-5: one unknown block among several known ones renders every
 *    OTHER block normally;
 *  - §3 AC-6: renderEmailTemplate (src/lib/email/merge-tags.ts) is
 *    UNMODIFIED by this ticket;
 *  - §3 AC-7: the plain-text derivation never exceeds the existing 64 KB
 *    bodyText cap for realistic content and contains no raw HTML tags;
 *  - Shared decisions: renderEmailDefinitionPreview's `bodyMode` branch is
 *    the ONLY change to that function — text-mode behavior (bodyMode
 *    omitted/"text") is byte-for-byte identical to before this ticket.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deriveBodyForDefinition,
  deriveBodyHtmlFromBlocks,
  deriveBodyHtmlTemplate,
  deriveBodyTextFromBlocks,
  renderEmailDefinitionPreview,
} from "@/features/emails/server/render";
import { validateRenderedEmailContent } from "@/lib/email/schemas";
import type { EmailPuckBlock } from "@/types/collection";

function heroBlock(id: string): EmailPuckBlock {
  return {
    id,
    type: "Hero",
    props: {
      eyebrow: "Conference",
      heading: "Welcome to the summit",
      body: "Join us for a day of talks and networking.",
      primaryCtaLabel: "Register",
      secondaryCtaLabel: "Learn more",
      imageUrl: "https://images.example.com/hero.jpg",
    },
  };
}

describe("deriveBodyHtmlFromBlocks — unknown-type skip (spec §1 AC-8 / §3 AC-5)", () => {
  it("skips an unknown block type, never throws, renders every OTHER block normally", () => {
    const blocks: EmailPuckBlock[] = [
      heroBlock("hero-1"),
      {
        id: "legacy-cta",
        type: "CallToAction" as EmailPuckBlock["type"],
        props: { title: "x", body: "x", buttonLabel: "x" },
      },
      {
        id: "schedule-1",
        type: "Schedule",
        props: { title: "Agenda", agenda: "09:00 Doors open" },
      },
    ];

    let html = "";
    expect(() => {
      html = deriveBodyHtmlFromBlocks(blocks);
    }).not.toThrow();

    expect(html).toContain("Welcome to the summit");
    expect(html).toContain("Agenda");
    // The unknown block contributed NOTHING — never a raw-props dump.
    expect(html).not.toContain("buttonLabel");
  });

  it("an empty block list renders an empty string (spec §8-1: empty canvas, never a crash)", () => {
    expect(deriveBodyHtmlFromBlocks([])).toBe("");
  });
});

describe("deriveBodyForDefinition — the ONE branch every real send call site reuses (Shared decisions)", () => {
  // Every M6-T3 trigger path (fire-on-submit-email.ts, fire-on-accept-
  // email.ts, paged-trigger-runner.ts) and every M6-T2 send surface
  // (test-send/route.ts, drafts/email-all/route.ts) calls this exact
  // function instead of re-implementing the bodyMode branch by hand — this
  // is what makes "every existing caller gets block-designer support for
  // free" true rather than aspirational.
  it("a definition shape with bodyMode omitted behaves identically to a plain-text-only definition", () => {
    // QA-D-2 fix (spec §6 AC-2): deriveBodyForDefinition now wraps its
    // fragment in a document shell with the required dark-mode meta tags
    // (src/__tests__/email-dark-mode-meta.test.ts) — so this is no longer a
    // byte-for-byte match with the bare deriveBodyHtmlTemplate fragment, but
    // the fragment must still be contained verbatim inside the wrapper.
    const result = deriveBodyForDefinition({ body: "Hello {first_name}" });
    expect(result.bodyHtml).toContain(
      deriveBodyHtmlTemplate("Hello {first_name}"),
    );
    expect(result.bodyHtml).toContain(
      '<meta name="color-scheme" content="light">',
    );
    expect(result.bodyText).toBe("Hello {first_name}");
  });

  it("bodyMode 'text' ignores bodyBlocks entirely, even if present", () => {
    const result = deriveBodyForDefinition({
      body: "Plain text wins",
      bodyMode: "text",
      bodyBlocks: [heroBlock("hero-1")],
    });
    expect(result.bodyText).toBe("Plain text wins");
    expect(result.bodyHtml).not.toContain("Welcome to the summit");
  });

  it("bodyMode 'blocks' ignores the plain-text body entirely", () => {
    const result = deriveBodyForDefinition({
      body: "THIS MUST NOT APPEAR",
      bodyMode: "blocks",
      bodyBlocks: [heroBlock("hero-1")],
    });
    expect(result.bodyHtml).toContain("Welcome to the summit");
    expect(result.bodyHtml).not.toContain("THIS MUST NOT APPEAR");
    expect(result.bodyText).not.toContain("THIS MUST NOT APPEAR");
  });

  it("bodyMode 'blocks' with an empty/absent bodyBlocks array never crashes", () => {
    expect(() =>
      deriveBodyForDefinition({ body: "", bodyMode: "blocks" }),
    ).not.toThrow();
    const result = deriveBodyForDefinition({ body: "", bodyMode: "blocks" });
    // QA-D-2 fix (spec §6 AC-2): the empty canvas still gets wrapped in a
    // valid document shell (empty inner content, but the dark-mode meta
    // tags/doctype are always present) — never a bare empty string anymore.
    expect(result.bodyHtml).toContain(
      '<meta name="color-scheme" content="light">',
    );
    expect(result.bodyHtml).toContain("<body");
    expect(result.bodyText).toBe("");
  });
});

describe("renderEmailDefinitionPreview — bodyMode branch (Shared decisions: ONE change to this function)", () => {
  it("bodyMode omitted defaults to text mode — IDENTICAL behavior to before this ticket", () => {
    const result = renderEmailDefinitionPreview({
      subjectTemplate: "Hi {first_name}",
      bodyTemplate: "<script>alert(1)</script> Dear {first_name},",
      context: { firstName: "Kenneth" },
    });
    expect(result.bodyHtml).not.toContain("<script>alert(1)</script>");
    expect(result.bodyHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result.subject).toBe("Hi Kenneth");
  });

  it("bodyMode explicitly 'text' behaves identically to omitting it", () => {
    const input = {
      subjectTemplate: "Hi {first_name}",
      bodyTemplate: "Dear {first_name},",
      context: { firstName: "Kenneth" },
    };
    const withoutMode = renderEmailDefinitionPreview(input);
    const withMode = renderEmailDefinitionPreview({
      ...input,
      bodyMode: "text" as const,
    });
    expect(withMode).toEqual(withoutMode);
  });

  it("bodyMode 'blocks' renders bodyBlocks through deriveBodyHtmlFromBlocks/deriveBodyTextFromBlocks, ignoring bodyTemplate", () => {
    const result = renderEmailDefinitionPreview({
      subjectTemplate: "Hi {first_name}",
      // bodyTemplate is present (the definition's plain-text draft is never
      // deleted when switching modes, spec §2 AC-4) but MUST be ignored
      // while bodyMode is "blocks".
      bodyTemplate: "THIS PLAIN TEXT MUST NOT APPEAR",
      context: { firstName: "Kenneth" },
      bodyMode: "blocks",
      bodyBlocks: [heroBlock("hero-1")],
    });

    expect(result.bodyHtml).toContain("Welcome to the summit");
    expect(result.bodyHtml).not.toContain("THIS PLAIN TEXT MUST NOT APPEAR");
    expect(result.bodyText).toContain("Welcome to the summit");
    expect(result.bodyText).not.toContain("THIS PLAIN TEXT MUST NOT APPEAR");
  });

  it("merge tags embedded inside block prop text still substitute (spec §3.1 step 4)", () => {
    const result = renderEmailDefinitionPreview({
      subjectTemplate: "Hi {first_name}",
      bodyTemplate: "",
      context: { firstName: "Priya" },
      bodyMode: "blocks",
      bodyBlocks: [
        {
          id: "schedule-1",
          type: "Schedule",
          props: { title: "Hi {first_name}", agenda: "See you there." },
        },
      ],
    });
    expect(result.bodyHtml).toContain("Hi Priya");
    expect(result.bodyText).toContain("Hi Priya");
  });

  it("a block-mode RegistrationEmbed's {event_url} literal substitutes via the SAME merge pass", () => {
    const result = renderEmailDefinitionPreview({
      subjectTemplate: "Subject",
      bodyTemplate: "",
      context: { eventUrl: "https://app.example.com/events/evt-1" },
      bodyMode: "blocks",
      bodyBlocks: [
        {
          id: "reg-1",
          type: "RegistrationEmbed",
          props: { title: "Register", body: "", buttonLabel: "Register now" },
        },
      ],
    });
    expect(result.bodyHtml).toContain(
      'href="https://app.example.com/events/evt-1"',
    );
    expect(result.bodyText).toContain("https://app.example.com/events/evt-1");
  });
});

describe("§3 AC-4 — the existing 256 KB rendered-bodyHtml cap still applies unchanged to block-mode output", () => {
  it("a realistic maximal (20-block) design stays comfortably under the 256 KB cap", () => {
    const blocks: EmailPuckBlock[] = Array.from({ length: 20 }, (_, i) =>
      heroBlock(`hero-${i}`),
    );
    const html = deriveBodyHtmlFromBlocks(blocks);
    const result = validateRenderedEmailContent({
      subject: "Subject",
      bodyHtml: html,
      bodyText: deriveBodyTextFromBlocks(blocks),
    });
    expect(result.ok).toBe(true);
  });

  it("a deliberately pathological all-text-maxed-out fixture is ALLOWED to legitimately fail the 256 KB cap — the cap is not raised for block mode", () => {
    // NOTE: this fixture deliberately uses MORE than EMAIL_BODY_BLOCKS_MAX_COUNT
    // (20) blocks fed directly to deriveBodyHtmlFromBlocks (bypassing the
    // write-time 20-block/48 KB caps entirely) — that is the point: this
    // proves the EXISTING 256 KB rendered-output cap is a genuine,
    // independent backstop that still catches oversized output even for
    // data that somehow bypassed the write-time caps (e.g. a future
    // migration script), not merely redundant with them. A 20-block,
    // schema-legal fixture (the case above) stays comfortably under 256 KB
    // by design — every free-text prop is defensively re-bounded at render
    // time (src/features/emails/server/blocks/text-utils.ts), so the
    // write-time-legal maximum is itself well under this cap.
    const maxedHighlights: EmailPuckBlock = {
      id: "highlights-maxed",
      type: "Highlights",
      props: {
        title: "x".repeat(200),
        intro: "x".repeat(2000),
        itemOneTitle: "x".repeat(200),
        itemOneBody: "x".repeat(2000),
        itemTwoTitle: "x".repeat(200),
        itemTwoBody: "x".repeat(2000),
        itemThreeTitle: "x".repeat(200),
        itemThreeBody: "x".repeat(2000),
      },
    };
    const blocks: EmailPuckBlock[] = Array.from({ length: 40 }, (_, i) => ({
      ...maxedHighlights,
      id: `highlights-${i}`,
    }));
    const html = deriveBodyHtmlFromBlocks(blocks);
    const result = validateRenderedEmailContent({
      subject: "Subject",
      bodyHtml: html,
      bodyText: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContain("BODY_HTML_TOO_LARGE");
    }
  });
});

describe("§3.3 / AC-7 — plain-text derivation", () => {
  it("walks block PROPS directly — no raw HTML tags, no leftover HTML entities from a naive strip-tags approach", () => {
    const text = deriveBodyTextFromBlocks([heroBlock("hero-1")]);
    expect(text).not.toMatch(/<[a-z][\s\S]*>/i);
    expect(text).not.toContain("&amp;");
    expect(text).not.toContain("&lt;");
  });

  it("an image-only Hero with no heading/body contributes NOTHING — never a broken empty line", () => {
    const text = deriveBodyTextFromBlocks([
      {
        id: "hero-image-only",
        type: "Hero",
        props: {
          eyebrow: "",
          heading: "",
          body: "",
          primaryCtaLabel: "",
          secondaryCtaLabel: "",
          imageUrl: "https://images.example.com/hero.jpg",
        },
      },
    ]);
    expect(text).toBe("");
  });

  it("TicketPricingTable degrades to the spec's own descriptive line", () => {
    const text = deriveBodyTextFromBlocks([
      {
        id: "pricing-1",
        type: "TicketPricingTable",
        props: { title: "", intro: "", emptyMessage: "" },
      },
    ]);
    expect(text).toContain("View current ticket pricing: {event_url}");
  });

  it("a realistic 20-block design's plain text stays under the existing 64 KB bodyText cap", () => {
    const blocks: EmailPuckBlock[] = Array.from({ length: 20 }, (_, i) =>
      heroBlock(`hero-${i}`),
    );
    const text = deriveBodyTextFromBlocks(blocks);
    const result = validateRenderedEmailContent({
      subject: "Subject",
      bodyHtml: "",
      bodyText: text,
    });
    expect(result.ok).toBe(true);
  });
});

describe("§3 AC-6 — renderEmailTemplate / merge-tags.ts is NOT modified by this ticket", () => {
  it("src/lib/email/merge-tags.ts source hash matches the pre-T4 snapshot (tripwire — update deliberately, not accidentally, if this ever legitimately changes)", () => {
    const filePath = join(
      process.cwd(),
      "src",
      "lib",
      "email",
      "merge-tags.ts",
    );
    const content = readFileSync(filePath, "utf8");
    const hash = createHash("sha256").update(content).digest("hex");
    expect(hash).toBe(
      "e33eadbb83e919e9259265fff4c462f815f0e45c629a9d16cb20e76baefdef86",
    );
  });

  it("deriveBodyHtmlTemplate (text mode) is untouched — byte-for-byte identical output to the existing T2 fixture", () => {
    const html = deriveBodyHtmlTemplate(
      "Line one\nLine two\n\nSecond paragraph",
    );
    expect(html).toBe("<p>Line one<br>Line two</p>\n<p>Second paragraph</p>");
  });
});
