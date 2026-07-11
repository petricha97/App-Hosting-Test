// @vitest-environment node
/**
 * M5-T3 — Abandoned tab pure helpers (spec T3 AC-1/2/3):
 * - serializeAbandonedDrafts keeps ONLY isAbandoned drafts (the strict >24h
 *   derivation lives in the DAL — this layer must not re-widen it);
 * - emails are masked to DOMAIN ONLY before they can reach any client —
 *   the local part never appears in the serialized output;
 * - blank names render the em dash; all four step labels exist with the
 *   amber/neutral split from the prototype.
 */
import { describe, expect, it } from "vitest";

import {
  DRAFT_STEP_LABELS,
  isLateDraftStep,
  maskEmailDomain,
  serializeAbandonedDrafts,
} from "@/features/attendees/abandoned";
import type { AdminRegistrationDraftListItem } from "@/lib/db/adminRegistrationDraft";

function ts(ms: number) {
  return {
    toDate: () => new Date(ms),
    toMillis: () => ms,
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
  };
}

function makeDraft(
  overrides: Partial<AdminRegistrationDraftListItem> = {},
): AdminRegistrationDraftListItem {
  return {
    id: "draft-1",
    organizationId: "org-1",
    eventId: "evt-1",
    pathId: "path-1",
    formId: "form-1",
    draftTokenHash: "hash",
    lastStepReached: "ticket_options",
    stepAnswers: {},
    ticketTypeId: null,
    registrationTypeId: null,
    promotionId: null,
    attempt: 1,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada.lovelace@dentsu.com",
    createdAt: ts(1000),
    updatedAt: ts(2000),
    isAbandoned: true,
    ...overrides,
  } as AdminRegistrationDraftListItem;
}

describe("maskEmailDomain", () => {
  it("keeps the domain only", () => {
    expect(maskEmailDomain("ada.lovelace@dentsu.com")).toBe("@dentsu.com");
    expect(maskEmailDomain("X@Sub.Example.CO.UK")).toBe("@sub.example.co.uk");
  });

  it("never emits the local part", () => {
    expect(maskEmailDomain("ada.lovelace@dentsu.com")).not.toContain(
      "ada.lovelace",
    );
  });

  it("masks blank/unparseable emails to the em dash — never a partial address", () => {
    expect(maskEmailDomain("")).toBe("—");
    expect(maskEmailDomain("not-an-email")).toBe("—");
  });
});

describe("serializeAbandonedDrafts", () => {
  it("keeps only isAbandoned drafts (T3 AC-1)", () => {
    const rows = serializeAbandonedDrafts([
      makeDraft({ id: "old", isAbandoned: true }),
      makeDraft({ id: "fresh-23h59m", isAbandoned: false }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["old"]);
  });

  it("serializes name, masked email, step and date — no full email anywhere", () => {
    const [row] = serializeAbandonedDrafts([makeDraft()]);

    expect(row).toEqual({
      id: "draft-1",
      name: "Ada Lovelace",
      maskedEmail: "@dentsu.com",
      lastStepReached: "ticket_options",
      updatedAtIso: new Date(2000).toISOString(),
    });
    expect(JSON.stringify(row)).not.toContain("ada.lovelace");
  });

  it("blank names render the em dash without dropping the row (T3 AC-2)", () => {
    const [row] = serializeAbandonedDrafts([
      makeDraft({ firstName: "", lastName: "" }),
    ]);
    expect(row.name).toBe("—");
  });
});

describe("step labels", () => {
  it("maps all four steps to the prototype labels", () => {
    expect(DRAFT_STEP_LABELS).toEqual({
      personal_info: "Personal Information",
      ticket_options: "Ticket & Options",
      summary: "Registration Summary",
      payment: "Payment",
    });
  });

  it("marks summary/payment as the amber (late) steps", () => {
    expect(isLateDraftStep("summary")).toBe(true);
    expect(isLateDraftStep("payment")).toBe(true);
    expect(isLateDraftStep("personal_info")).toBe(false);
    expect(isLateDraftStep("ticket_options")).toBe(false);
  });
});
