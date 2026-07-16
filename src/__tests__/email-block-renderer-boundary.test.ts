// @vitest-environment node
/**
 * M6-T4 — import-boundary guards for src/features/emails/server/blocks/*
 * (the new, most security-sensitive surface in this ticket). Mirrors
 * email-import-boundary.test.ts's existing checks for
 * src/lib/email/src/features/emails/server, extended to this subdirectory
 * specifically because that existing test only scans its two target
 * directories NON-recursively (readdirSync without a subdirectory walk) and
 * would silently skip this new directory otherwise.
 *
 * Locks:
 *  - every module here is marked "server-only" (never reachable from a
 *    client bundle — this code renders organizer-authored content into raw
 *    HTML with zero sanitization downstream, it must never run/be bundled
 *    client-side);
 *  - no direct Firestore access (DAL-only rule — this module receives
 *    already-loaded data via function arguments, never fetches itself);
 *  - no block renderer imports a "use client" module (the web page
 *    builder's React block registry, src/features/event-pages/puck.tsx) —
 *    this is a from-scratch, server-only HTML-string renderer, never a
 *    reuse of the web block's JSX (Shared decisions: "Reusing the web
 *    render closures for email output is not an option").
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

describe("src/features/emails/server/blocks import boundaries (M6-T4)", () => {
  const modules = blockModules();

  it("finds the block renderer modules (guards against an empty/misconfigured scan)", () => {
    expect(modules.length).toBeGreaterThanOrEqual(9);
  });

  it('marks every module "server-only"', () => {
    for (const { name, content } of modules) {
      expect(content, `${name} must import "server-only"`).toMatch(
        /import "server-only";/,
      );
    }
  });

  it("keeps Firestore access out of this directory (DAL-only rule)", () => {
    for (const { name, content } of modules) {
      expect(
        content.includes('from "firebase-admin/firestore"') ||
          content.includes('from "@/app/lib/firestore"') ||
          content.includes('from "firebase/firestore"'),
        `${name} must not touch Firestore directly — go through src/lib/db/`,
      ).toBe(false);
    }
  });

  it("never imports the client-side web page-builder Puck registry", () => {
    for (const { name, content } of modules) {
      expect(
        content.includes('from "@/features/event-pages/puck"'),
        `${name} must not reuse the web block's client-side render closures — this module renders from-scratch, server-only HTML strings (Shared decisions)`,
      ).toBe(false);
    }
  });

  it('never OPENS with a "use client" directive (Next.js convention: must be the first statement)', () => {
    for (const { name, content } of modules) {
      const firstStatement = content
        .split("\n")
        .find(
          (line) => line.trim().length > 0 && !line.trim().startsWith("//"),
        );
      expect(
        firstStatement?.trim().startsWith('"use client"'),
        `${name} must never be a client component`,
      ).toBe(false);
    }
  });
});
