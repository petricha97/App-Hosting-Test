// @vitest-environment node
/**
 * M6-T1 — deterministic EmailMessage doc ids (src/lib/db/emailMessageId.ts).
 * Spec: agents/docs/specs/m6-email-infrastructure.md (Shared decisions:
 * "never double-send by construction").
 *
 * Locks:
 *  - same logical-send tuple -> same id (idempotent enqueue substrate)
 *  - recipient email is case-insensitive (lowercased before hashing)
 *  - every tuple element is id-bearing (org/event/kind/recipient/dedupeKey)
 *  - JSON tuple encoding -> no separator ambiguity between fields
 *  - "EmailMessage" domain prefix keeps the derivation disjoint from the
 *    Attendee/FormData id families
 */
import { describe, expect, it } from "vitest";

import { attendeeIdFromSubmissionId } from "@/lib/db/attendeeId";
import { emailMessageId } from "@/lib/db/emailMessageId";
import { formDataIdFromDraftId } from "@/lib/db/formDataId";

const BASE = {
  organizationId: "org-1",
  eventId: "evt-1",
  kind: "confirmation-paid",
  recipientEmail: "kenneth@example.com",
  dedupeKey: "submission-1",
};

describe("emailMessageId", () => {
  it("is deterministic: the same tuple always yields the same sha256 hex id", () => {
    const a = emailMessageId(BASE);
    const b = emailMessageId({ ...BASE });

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lowercases the recipient email — case variants collapse onto one doc", () => {
    expect(
      emailMessageId({ ...BASE, recipientEmail: "Kenneth@Example.COM" }),
    ).toBe(emailMessageId(BASE));
  });

  it("changes when any tuple element changes", () => {
    const base = emailMessageId(BASE);

    expect(emailMessageId({ ...BASE, organizationId: "org-2" })).not.toBe(base);
    expect(emailMessageId({ ...BASE, eventId: "evt-2" })).not.toBe(base);
    expect(emailMessageId({ ...BASE, kind: "manual" })).not.toBe(base);
    expect(
      emailMessageId({ ...BASE, recipientEmail: "other@example.com" }),
    ).not.toBe(base);
    expect(emailMessageId({ ...BASE, dedupeKey: "submission-2" })).not.toBe(
      base,
    );
  });

  it("a new dedupeKey = a new logical send = a new doc id (deliberate re-send)", () => {
    expect(
      emailMessageId({ ...BASE, dedupeKey: "resend-2026-07-13" }),
    ).not.toBe(emailMessageId(BASE));
  });

  it("has no separator ambiguity between adjacent tuple fields", () => {
    // Without JSON encoding, kind "a,b" + dedupeKey "c" could collide with
    // kind "a" + dedupeKey "b,c".
    expect(emailMessageId({ ...BASE, kind: "a,b", dedupeKey: "c" })).not.toBe(
      emailMessageId({ ...BASE, kind: "a", dedupeKey: "b,c" }),
    );
  });

  it("never collides with the Attendee / FormData id derivations", () => {
    const shared = {
      organizationId: BASE.organizationId,
      eventId: BASE.eventId,
    };

    const email = emailMessageId(BASE);
    expect(email).not.toBe(
      attendeeIdFromSubmissionId({ ...shared, submissionId: BASE.dedupeKey }),
    );
    expect(email).not.toBe(
      formDataIdFromDraftId({ ...shared, draftId: BASE.dedupeKey }),
    );
  });
});
