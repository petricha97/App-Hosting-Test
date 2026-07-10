/**
 * M3-T4 / review S6 — shared CSV download helper
 * (src/features/responses/download.ts), extracted from the two responses
 * browsers. Locks the blob → object-URL → anchor-click sequence, the object
 * URL cleanup, and the single failure toast on both non-OK responses and
 * network errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { downloadCsvExport } from "@/features/responses/download";

const OBJECT_URL = "blob:mock-url";

describe("downloadCsvExport", () => {
  let clickedDownloads: Array<{ href: string; download: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    clickedDownloads = [];

    // jsdom has no createObjectURL; anchors record their click instead of
    // navigating.
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => OBJECT_URL),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clickedDownloads.push({
          href: this.href,
          download: this.download,
        });
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("downloads the export blob via a temporary anchor and revokes the URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Name,Email\r\n", { status: 200 })),
    );

    const ok = await downloadCsvExport("/api/x/export", "responses-x.csv");

    expect(ok).toBe(true);
    expect(clickedDownloads).toEqual([
      { href: OBJECT_URL, download: "responses-x.csv" },
    ]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
    // The temporary anchor never lingers in the DOM.
    expect(document.querySelector("a")).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("toasts the shared failure message on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 403 })),
    );

    const ok = await downloadCsvExport("/api/x/export", "responses-x.csv");

    expect(ok).toBe(false);
    expect(clickedDownloads).toEqual([]);
    expect(toastError).toHaveBeenCalledWith("Export failed — try again.");
  });

  it("toasts the shared failure message on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    const ok = await downloadCsvExport("/api/x/export", "responses-x.csv");

    expect(ok).toBe(false);
    expect(toastError).toHaveBeenCalledWith("Export failed — try again.");
  });
});
