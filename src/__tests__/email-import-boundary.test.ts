// @vitest-environment node
/**
 * M6-T1 — import-boundary guards for the email substrate.
 * Spec: agents/docs/specs/m6-email-infrastructure.md (§1 AC-1/AC-5, §5).
 *
 * Locks:
 *  - every module under src/lib/email/ is marked "server-only" (nothing is
 *    importable into client bundles — DAL convention)
 *  - no production file imports the concrete dev-outbox transport except
 *    the factory (transport.ts): callers depend on the EmailTransport
 *    interface alone
 *  - the email service performs NO direct Firestore access — all
 *    firebase-admin usage stays inside src/lib/db/ (repo DAL rule)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const EMAIL_DIR = join(process.cwd(), "src", "lib", "email");

function emailModules(): Array<{ name: string; content: string }> {
  return readdirSync(EMAIL_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({
      name,
      content: readFileSync(join(EMAIL_DIR, name), "utf8"),
    }));
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("src/lib/email import boundaries", () => {
  it('marks every email module "server-only" (§1 AC-5)', () => {
    const modules = emailModules();

    expect(modules.length).toBeGreaterThan(0);
    for (const { name, content } of modules) {
      expect(content, `${name} must import "server-only"`).toMatch(
        /import "server-only";/,
      );
    }
  });

  it("only the factory (transport.ts) imports the concrete dev-outbox transport (§1 AC-1)", () => {
    const offenders = walk(join(process.cwd(), "src"))
      .filter((path) => !path.includes("__tests__"))
      .filter((path) =>
        readFileSync(path, "utf8").includes(
          'from "@/lib/email/dev-outbox-transport"',
        ),
      )
      .map((path) => path.split("/src/")[1]);

    expect(offenders).toEqual(["lib/email/transport.ts"]);
  });

  it("keeps Firestore access out of src/lib/email (DAL-only rule)", () => {
    for (const { name, content } of emailModules()) {
      expect(
        content.includes('from "firebase-admin/firestore"') ||
          content.includes('from "@/app/lib/firestore"'),
        `${name} must not touch Firestore directly — go through src/lib/db/`,
      ).toBe(false);
    }
  });
});
