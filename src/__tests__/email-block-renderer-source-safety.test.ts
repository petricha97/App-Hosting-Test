// @vitest-environment node
/**
 * M6-T4 — source-level safety scan for the email-safe block renderers
 * (spec §3 AC-3: "No block renderer ever accepts or emits a free-text
 * `style` attribute value sourced from an organizer-typed prop — asserted
 * by a source-level test (grep/AST check across the block-renderer module
 * for any string-interpolated `style="` built from a non-enum prop) as
 * well as a runtime test").
 *
 * This is the source-level half of that AC (email-block-renderers.test.ts
 * covers the runtime half via renderStoryBlockHtml's "no display:flex/grid"
 * assertion and the general escaping suite).
 *
 * Method: every `style="..."` attribute literal in every block-renderer
 * source file is extracted; every `${...}` template interpolation found
 * INSIDE that attribute value must reference ONLY `EMAIL_BLOCK_COLORS.*`
 * (the fixed, code-authored color table, src/features/emails/server/
 * blocks/styles.ts) — never a prop-derived local variable (heading, body,
 * imageSrc, safeHref, buttonLabel, ...). This directly proves every style
 * attribute in this directory is built exclusively from static text plus a
 * fixed, reviewed color constant table — never from organizer input.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const BLOCKS_DIR = join(
  process.cwd(),
  "src",
  "features",
  "emails",
  "server",
  "blocks",
);

function blockModules(): Array<{ name: string; content: string }> {
  return readdirSync(BLOCKS_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({
      name,
      content: readFileSync(join(BLOCKS_DIR, name), "utf8"),
    }));
}

// Matches `style="...">` attribute VALUES in the source text (the source
// files are template literals, so this is a plain string search over the
// .ts source, not a runtime HTML parse).
const STYLE_ATTR_RE = /style="([^"]*)"/g;
const INTERPOLATION_RE = /\$\{([^}]*)\}/g;

describe("block renderer source safety — style attributes are never built from prop values (spec §3 AC-3)", () => {
  const modules = blockModules();

  it("finds the block renderer modules (guards against an empty/misconfigured scan)", () => {
    expect(modules.length).toBeGreaterThanOrEqual(9); // 8 blocks + styles.ts
  });

  for (const { name, content } of modules) {
    it(`${name}: every style="..." interpolation references only EMAIL_BLOCK_COLORS`, () => {
      const offendingExpressions: string[] = [];

      for (const styleMatch of content.matchAll(STYLE_ATTR_RE)) {
        const styleValue = styleMatch[1];
        for (const interpolationMatch of styleValue.matchAll(
          INTERPOLATION_RE,
        )) {
          const expression = interpolationMatch[1].trim();
          if (!expression.startsWith("EMAIL_BLOCK_COLORS.")) {
            offendingExpressions.push(expression);
          }
        }
      }

      expect(
        offendingExpressions,
        `${name} interpolates a non-EMAIL_BLOCK_COLORS expression into a style attribute: ${offendingExpressions.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("no block renderer module declares a prop named literally 'style' (no free-text style prop anywhere in the registry)", () => {
    for (const { name, content } of modules) {
      expect(
        /\bprops\.style\b/.test(content),
        `${name} must never read a "style" prop from organizer input`,
      ).toBe(false);
    }
  });
});
