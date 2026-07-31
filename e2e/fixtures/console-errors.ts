import type { Page } from "@playwright/test";

// M0-T3 cross-cutting check: fails the assertion if any Firestore
// "missing index" error (FAILED_PRECONDITION / "requires an index") surfaces
// in the browser console while exercising a list screen. Attach once per
// page and read `.errors` at the end of a test.
export function collectConsoleErrors(page: Page): { errors: string[] } {
  const state = { errors: [] as string[] };
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      state.errors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    state.errors.push(err.message);
  });
  return state;
}

export function findMissingIndexErrors(errors: string[]): string[] {
  return errors.filter(
    (message) =>
      /FAILED_PRECONDITION/i.test(message) ||
      /requires an index/i.test(message) ||
      /the query requires an index/i.test(message),
  );
}
