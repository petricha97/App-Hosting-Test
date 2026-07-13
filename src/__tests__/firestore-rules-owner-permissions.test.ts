/**
 * CI drift guard (M2 review R4 / rules-layer limit #2).
 *
 * The User-create owner shape in firestore.rules compares `permissions` by
 * exact, ORDER-SENSITIVE list equality against a hardcoded copy of
 * OWNER_PERMISSIONS — the rules language cannot import the TypeScript
 * constant, so the two lists can silently drift. If someone adds a
 * permission to src/types/collection.ts without updating firestore.rules,
 * every "create a brand-new org" signup starts failing with
 * permission-denied in production.
 *
 * This test reads firestore.rules AS TEXT, extracts the literal list from
 * the `request.resource.data.permissions == [...]` clause, and asserts it
 * matches OWNER_PERMISSIONS exactly (same values, same order) so the drift
 * fails CI instead of prod signups.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { OWNER_PERMISSIONS } from "@/types/collection";

// Vitest's root is the repo root (vitest.config.mts lives there), so cwd is
// stable; import.meta.url is NOT usable under the jsdom environment.
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

function extractRulesPermissionLists(rulesText: string): string[][] {
  // Strip line comments so a commented-out copy of the list can't satisfy
  // (or confuse) the extraction.
  const withoutComments = rulesText
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

  const lists: string[][] = [];
  const clause = /request\.resource\.data\.permissions\s*==\s*\[([^\]]*)\]/g;
  for (const match of withoutComments.matchAll(clause)) {
    const items = [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    lists.push(items);
  }
  return lists;
}

describe("firestore.rules OWNER_PERMISSIONS literal", () => {
  const rulesText = readFileSync(RULES_PATH, "utf8");
  const lists = extractRulesPermissionLists(rulesText);

  it("contains exactly one permissions == [...] literal (the User-create owner shape)", () => {
    expect(lists).toHaveLength(1);
  });

  it("matches src/types/collection.ts OWNER_PERMISSIONS exactly, in order (rules list equality is order-sensitive)", () => {
    expect(lists[0]).toEqual([...OWNER_PERMISSIONS]);
  });
});
