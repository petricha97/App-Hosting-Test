// @vitest-environment node
/**
 * M6-T3 — dedupeKey formulas (src/lib/email/lifecycle/dedupe-keys.ts). Spec:
 * agents/docs/specs/m6-lifecycle-triggers.md §3/§4/§5.
 *
 * Locks (the safety-critical property the whole ticket rests on):
 *  - abandonedReminderDedupeKey === the draftId verbatim
 *  - unpaidOffsetDedupeKey produces THREE distinct keys per order (one per
 *    offset), stable across repeated calls with the same inputs
 *  - scheduledDedupeKey combines definitionId + recipientKey, distinct
 *    definitions never collide even with the same recipientKey
 */
import { describe, expect, it } from "vitest";

import {
  abandonedReminderDedupeKey,
  scheduledDedupeKey,
  unpaidOffsetDedupeKey,
} from "@/lib/email/lifecycle/dedupe-keys";

describe("abandonedReminderDedupeKey", () => {
  it("is the draftId verbatim, stable across calls", () => {
    expect(abandonedReminderDedupeKey("draft-123")).toBe("draft-123");
    expect(abandonedReminderDedupeKey("draft-123")).toBe(
      abandonedReminderDedupeKey("draft-123"),
    );
  });
});

describe("unpaidOffsetDedupeKey", () => {
  it("produces the exact orderId:offsetDays formula", () => {
    expect(unpaidOffsetDedupeKey("order-1", 7)).toBe("order-1:7");
    expect(unpaidOffsetDedupeKey("order-1", 14)).toBe("order-1:14");
    expect(unpaidOffsetDedupeKey("order-1", 21)).toBe("order-1:21");
  });

  it("produces three distinct keys for the three offsets of one order", () => {
    const keys = [7, 14, 21].map((d) => unpaidOffsetDedupeKey("order-1", d));
    expect(new Set(keys).size).toBe(3);
  });

  it("is stable/deterministic across repeated calls with the same inputs", () => {
    expect(unpaidOffsetDedupeKey("order-1", 7)).toBe(
      unpaidOffsetDedupeKey("order-1", 7),
    );
  });

  it("never collides across orders sharing an offset", () => {
    expect(unpaidOffsetDedupeKey("order-1", 7)).not.toBe(
      unpaidOffsetDedupeKey("order-2", 7),
    );
  });
});

describe("scheduledDedupeKey", () => {
  it("combines definitionId + recipientKey", () => {
    expect(scheduledDedupeKey("def-1", "att-1")).toBe("def-1:att-1");
  });

  it("never collides across definitions for the same recipient", () => {
    expect(scheduledDedupeKey("def-1", "att-1")).not.toBe(
      scheduledDedupeKey("def-2", "att-1"),
    );
  });

  it("never collides across recipients for the same definition", () => {
    expect(scheduledDedupeKey("def-1", "att-1")).not.toBe(
      scheduledDedupeKey("def-1", "att-2"),
    );
  });
});
