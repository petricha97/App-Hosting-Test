/**
 * M3-T4 — status badge / filter UI helpers
 * (src/features/responses/status-utils.ts).
 *
 * Locks that the action menu derives its items from the SAME machine the
 * server enforces (forward-only, accepted terminal) and that the ?status=
 * URL parser only ever yields real statuses.
 */
import { describe, expect, it } from "vitest";

import {
  FORM_DATA_STATUS_LABELS,
  STATUS_ACTION_LABELS,
  forwardFormDataStatuses,
  parseStatusFilter,
} from "@/features/responses/status-utils";

describe("parseStatusFilter", () => {
  it("accepts each real status", () => {
    expect(parseStatusFilter("new")).toBe("new");
    expect(parseStatusFilter("pending")).toBe("pending");
    expect(parseStatusFilter("reviewed")).toBe("reviewed");
    expect(parseStatusFilter("accepted")).toBe("accepted");
  });

  it("returns undefined for 'any', empty, unknown, and missing values", () => {
    expect(parseStatusFilter("any")).toBeUndefined();
    expect(parseStatusFilter("")).toBeUndefined();
    expect(parseStatusFilter("rejected")).toBeUndefined();
    expect(parseStatusFilter("NEW")).toBeUndefined();
    expect(parseStatusFilter(undefined)).toBeUndefined();
    expect(parseStatusFilter(null)).toBeUndefined();
  });

  it("takes the first entry of a repeated URL param", () => {
    expect(parseStatusFilter(["pending", "accepted"])).toBe("pending");
    expect(parseStatusFilter([])).toBeUndefined();
  });
});

describe("forwardFormDataStatuses — mirrors the forward-only machine", () => {
  it("offers every forward move (skipping allowed)", () => {
    expect(forwardFormDataStatuses("new")).toEqual([
      "pending",
      "reviewed",
      "accepted",
    ]);
    expect(forwardFormDataStatuses("pending")).toEqual([
      "reviewed",
      "accepted",
    ]);
    expect(forwardFormDataStatuses("reviewed")).toEqual(["accepted"]);
  });

  it("offers nothing from accepted (terminal in M3 — row renders no menu)", () => {
    expect(forwardFormDataStatuses("accepted")).toEqual([]);
  });
});

describe("labels", () => {
  it("badge labels match the prototype set exactly (no 'rejected' in M3)", () => {
    expect(FORM_DATA_STATUS_LABELS).toEqual({
      new: "New",
      pending: "Pending",
      reviewed: "Reviewed",
      accepted: "Accepted",
    });
  });

  it("every forward target from 'new' has an action label", () => {
    for (const target of forwardFormDataStatuses("new")) {
      expect(
        STATUS_ACTION_LABELS[target as keyof typeof STATUS_ACTION_LABELS],
      ).toBeTruthy();
    }
  });
});
