// @vitest-environment node
/**
 * M6-T2 — deterministic EmailDefinition doc ids
 * (src/lib/db/emailDefinitionId.ts). Spec:
 * agents/docs/specs/m6-emails-admin.md (Shared decisions: "kind is the join
 * key; the definition doc id is deterministic from it").
 *
 * Locks:
 *  - same logical tuple (org, event, kind) -> same id (idempotent
 *    materialize/create substrate)
 *  - every tuple element is id-bearing (org/event/kind)
 *  - JSON tuple encoding -> no separator ambiguity between fields
 *  - "EmailDefinition" domain prefix keeps the derivation disjoint from the
 *    EmailMessage/Attendee/FormData id families
 */
import { describe, expect, it } from "vitest";

import { attendeeIdFromSubmissionId } from "@/lib/db/attendeeId";
import { emailDefinitionId } from "@/lib/db/emailDefinitionId";
import { emailMessageId } from "@/lib/db/emailMessageId";

const BASE = {
  organizationId: "org-1",
  eventId: "evt-1",
  kind: "confirmation-paid",
};

describe("emailDefinitionId", () => {
  it("is deterministic: the same tuple always yields the same sha256 hex id", () => {
    const a = emailDefinitionId(BASE);
    const b = emailDefinitionId({ ...BASE });

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any tuple element changes", () => {
    const base = emailDefinitionId(BASE);

    expect(emailDefinitionId({ ...BASE, organizationId: "org-2" })).not.toBe(
      base,
    );
    expect(emailDefinitionId({ ...BASE, eventId: "evt-2" })).not.toBe(base);
    expect(emailDefinitionId({ ...BASE, kind: "manual" })).not.toBe(base);
  });

  it("is unique per event by construction: two kinds never collide within the same event", () => {
    expect(emailDefinitionId({ ...BASE, kind: "abandoned-reminder" })).not.toBe(
      emailDefinitionId({ ...BASE, kind: "confirmation-paid" }),
    );
  });

  it("has no separator ambiguity between adjacent tuple fields", () => {
    // Without JSON encoding, eventId "a,b" + kind "c" could collide with
    // eventId "a" + kind "b,c".
    expect(emailDefinitionId({ ...BASE, eventId: "a,b", kind: "c" })).not.toBe(
      emailDefinitionId({ ...BASE, eventId: "a", kind: "b,c" }),
    );
  });

  it("never collides with the EmailMessage / Attendee id derivations", () => {
    const definitionId = emailDefinitionId(BASE);

    expect(definitionId).not.toBe(
      emailMessageId({
        ...BASE,
        recipientEmail: "kenneth@example.com",
        dedupeKey: BASE.kind,
      }),
    );
    expect(definitionId).not.toBe(
      attendeeIdFromSubmissionId({
        organizationId: BASE.organizationId,
        eventId: BASE.eventId,
        submissionId: BASE.kind,
      }),
    );
  });
});
