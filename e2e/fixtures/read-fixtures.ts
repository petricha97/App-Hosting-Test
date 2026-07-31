import fs from "node:fs";

import { FIXTURES_FILE, type SeededFixtures } from "./test-data";

// Reads the org/event created once by e2e/auth.setup.ts. Only call this from
// spec files in the "chromium" project — it depends on the "setup" project
// having already run (see playwright.config.ts `dependencies`).
export function readSeededFixtures(): SeededFixtures {
  const raw = fs.readFileSync(FIXTURES_FILE, "utf-8");
  return JSON.parse(raw) as SeededFixtures;
}
