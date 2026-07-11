// @vitest-environment node
/**
 * M5-T1 — accept side-effect hook (src/features/responses/
 * on-submission-accepted.ts), integration-tested through the REAL
 * transitionAdminFormDataStatus (the injectable onAccepted seam stays
 * intact — see the "injected seam" case). Spec: agents/docs/specs/
 * m5-attendees-checkin.md (T1 AC-1/AC-2/AC-3/AC-6/AC-8).
 *
 * Locks:
 *  - accept creates exactly ONE Attendee at the deterministic id with all
 *    denorms (personal fields from the submission map, regType label from
 *    the Order -> RegistrationType read, ticketLabel from the FormData
 *    denorm) and flips attendeeCreated:true
 *  - the attendee INHERITS the finalize-stamped qrTokenHash; legacy flat
 *    submissions get a freshly minted deterministic hash + a FormData
 *    backfill; a finalize-stamped hash is never rewritten
 *  - double-accept: second transition fails INVALID_TRANSITION before the
 *    hook; direct double-invoke of the hook is idempotent (one doc)
 *  - hook failure NEVER un-accepts: status stays "accepted",
 *    attendeeCreated stays false ("hook pending"), and a direct re-invoke
 *    heals it
 *  - missing-order degradation: unresolvable orderId -> legacy shape, no
 *    crash
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

import { Timestamp } from "firebase-admin/firestore";

import { attendeeIdFromSubmissionId } from "@/lib/db/attendeeId";
import { QR_TOKEN_SECRET_ENV, hashQrToken, mintQrToken } from "@/lib/qr/qr-token";
import type { FormDataDoc } from "@/types/collection";

// Deterministic token math needs a pinned secret for the whole file.
process.env[QR_TOKEN_SECRET_ENV] = "unit-test-qr-secret";

const { transitionAdminFormDataStatus } = await import("@/lib/db/adminFormData");
const { ATTENDEE_LABEL_FALLBACK, attendeePersonalFieldsFromSubmission, onSubmissionAccepted } =
  await import("@/features/responses/on-submission-accepted");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const RESPONSE_ID = "resp-1";
const ORDER_ID = "ord-1";
const REG_TYPE_ID = "rt-1";
const TICKET_TYPE_ID = "tt-1";

const ATTENDEE_ID = attendeeIdFromSubmissionId({
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  submissionId: RESPONSE_ID,
});
const ATTENDEE_PATH = `Attendee/${ATTENDEE_ID}`;
const RESPONSE_PATH = `FormData/${RESPONSE_ID}`;

const EXPECTED_QR_HASH = hashQrToken(
  mintQrToken({ eventId: EVENT_ID, formDataId: RESPONSE_ID }),
);

const FULL_SUBMISSION = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@dentsu.com",
  company: "Dentsu",
  job_title: "Engineer",
  dietary: "vegan",
};

function seedResponse(overrides: Partial<FormDataDoc> = {}) {
  fake.store.set(RESPONSE_PATH, {
    formId: "form-1",
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    submission: FULL_SUBMISSION,
    submittedAt: Timestamp.fromMillis(1_000),
    status: "reviewed",
    orderId: ORDER_ID,
    pathId: "path-1",
    ticketLabel: "VIP",
    statusUpdatedAt: null,
    acceptedAt: null,
    attendeeCreated: false,
    qrTokenHash: EXPECTED_QR_HASH,
    ...overrides,
  });
}

function seedOrder() {
  fake.store.set(`Order/${ORDER_ID}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId: RESPONSE_ID,
    ticketTypeId: TICKET_TYPE_ID,
    registrationTypeId: REG_TYPE_ID,
    feeId: "fee-1",
  });
}

function seedRegistrationType() {
  fake.store.set(`RegistrationType/${REG_TYPE_ID}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    name: "Delegate",
    code: "DEL",
    capacity: null,
    registeredCount: 1,
  });
}

function accept(overrides = {}) {
  return transitionAdminFormDataStatus({
    responseId: RESPONSE_ID,
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    to: "accepted",
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe("attendeePersonalFieldsFromSubmission (pure denorm)", () => {
  it("maps the five keys, trims, and defaults missing keys to empty strings", () => {
    expect(attendeePersonalFieldsFromSubmission(FULL_SUBMISSION)).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@dentsu.com",
      company: "Dentsu",
      jobTitle: "Engineer",
    });
    expect(
      attendeePersonalFieldsFromSubmission({ first_name: "  Ada  " }),
    ).toEqual({
      firstName: "Ada",
      lastName: "",
      email: "",
      company: "",
      jobTitle: "",
    });
    expect(attendeePersonalFieldsFromSubmission({})).toEqual({
      firstName: "",
      lastName: "",
      email: "",
      company: "",
      jobTitle: "",
    });
  });
});

describe("accept -> attendee creation (T1 AC-1)", () => {
  it("creates exactly one fully denormalized Attendee and flips attendeeCreated", async () => {
    seedResponse();
    seedOrder();
    seedRegistrationType();

    const result = await accept();

    expect(result).toMatchObject({ ok: true });
    const attendee = fake.store.get(ATTENDEE_PATH)!;
    expect(attendee).toMatchObject({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: RESPONSE_ID,
      orderId: ORDER_ID,
      pathId: "path-1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@dentsu.com",
      company: "Dentsu",
      jobTitle: "Engineer",
      registrationTypeId: REG_TYPE_ID,
      registrationTypeLabel: "Delegate",
      ticketTypeId: TICKET_TYPE_ID,
      ticketLabel: "VIP",
      status: "accepted",
      checkInState: "not-arrived",
      checkedInAt: null,
      checkedInBy: null,
      // Inherited from the finalize-stamped FormData hash (AC-1 + one-QR).
      qrTokenHash: EXPECTED_QR_HASH,
    });

    const response = fake.store.get(RESPONSE_PATH)!;
    expect(response.status).toBe("accepted");
    expect(response.attendeeCreated).toBe(true);
    // Finalize-stamped hash untouched.
    expect(response.qrTokenHash).toBe(EXPECTED_QR_HASH);
  });

  it("accepts a LEGACY flat submission: null ids, fallback labels, freshly minted hash (T1 AC-3)", async () => {
    seedResponse({
      submission: { first_name: "Grace" },
      orderId: undefined,
      pathId: undefined,
      ticketLabel: undefined,
      qrTokenHash: undefined,
      status: undefined, // legacy docs read as "new"
    });

    const result = await accept();

    expect(result).toMatchObject({ ok: true });
    const attendee = fake.store.get(ATTENDEE_PATH)!;
    expect(attendee).toMatchObject({
      orderId: null,
      pathId: null,
      firstName: "Grace",
      lastName: "",
      email: "",
      registrationTypeId: null,
      registrationTypeLabel: ATTENDEE_LABEL_FALLBACK,
      ticketTypeId: null,
      ticketLabel: ATTENDEE_LABEL_FALLBACK,
      qrTokenHash: EXPECTED_QR_HASH, // deterministic mint == inherit
    });
    // Backfilled onto the FormData doc for future re-mints/emails.
    expect(fake.store.get(RESPONSE_PATH)!.qrTokenHash).toBe(EXPECTED_QR_HASH);
    expect(fake.store.get(RESPONSE_PATH)!.attendeeCreated).toBe(true);
  });

  it("degrades an unresolvable orderId to the legacy shape instead of crashing", async () => {
    seedResponse(); // orderId set, but no Order doc seeded

    const result = await accept();

    expect(result).toMatchObject({ ok: true });
    expect(fake.store.get(ATTENDEE_PATH)!).toMatchObject({
      orderId: ORDER_ID, // the reference is kept for audit
      registrationTypeId: null,
      registrationTypeLabel: ATTENDEE_LABEL_FALLBACK,
      ticketTypeId: null,
      ticketLabel: "VIP", // FormData denorm still present
    });
  });

  it("falls back to the fallback label when the RegistrationType doc is gone", async () => {
    seedResponse();
    seedOrder(); // regType id present on the order, doc missing

    await accept();

    expect(fake.store.get(ATTENDEE_PATH)!).toMatchObject({
      registrationTypeId: REG_TYPE_ID,
      registrationTypeLabel: ATTENDEE_LABEL_FALLBACK,
    });
  });
});

describe("idempotency (T1 AC-2)", () => {
  it("double-accept yields exactly one attendee — the second transition fails before the hook", async () => {
    seedResponse();
    seedOrder();
    seedRegistrationType();

    const first = await accept();
    const second = await accept();

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    const attendeePaths = [...fake.store.keys()].filter((p) =>
      p.startsWith("Attendee/"),
    );
    expect(attendeePaths).toEqual([ATTENDEE_PATH]);
  });

  it("direct double-invoke of the hook is idempotent: one doc, replay keeps the original", async () => {
    seedResponse();
    seedOrder();
    seedRegistrationType();
    await accept();

    // Re-invoke (the documented healing path for attendeeCreated:false).
    const submission = {
      id: RESPONSE_ID,
      ...(fake.store.get(RESPONSE_PATH) as unknown as FormDataDoc),
    };
    await onSubmissionAccepted(submission);

    const attendeePaths = [...fake.store.keys()].filter((p) =>
      p.startsWith("Attendee/"),
    );
    expect(attendeePaths).toEqual([ATTENDEE_PATH]);
    expect(fake.store.get(ATTENDEE_PATH)!.firstName).toBe("Ada");
    // No duplicate attendee create writes.
    expect(
      fake.writes.filter(
        (w) => w.type === "create" && w.path.startsWith("Attendee/"),
      ),
    ).toHaveLength(1);
  });

  it("a failing hook never un-accepts: status stands, attendeeCreated stays false, re-invoke heals", async () => {
    seedResponse();
    seedOrder();
    seedRegistrationType();

    // The injectable seam transitionAdminFormDataStatus exposes (kept for M5).
    const boom = vi.fn().mockRejectedValue(new Error("attendee infra down"));
    await expect(accept({ onAccepted: boom })).rejects.toThrow(
      "attendee infra down",
    );

    const response = fake.store.get(RESPONSE_PATH)!;
    expect(response.status).toBe("accepted"); // commit stands (T1 contract)
    expect(response.attendeeCreated).toBe(false); // "hook pending" signal
    expect(fake.store.get(ATTENDEE_PATH)).toBeUndefined();

    // Healing = idempotent direct re-invoke with the accepted submission.
    await onSubmissionAccepted({
      id: RESPONSE_ID,
      ...(response as unknown as FormDataDoc),
    });
    expect(fake.store.get(ATTENDEE_PATH)).toMatchObject({
      firstName: "Ada",
      registrationTypeLabel: "Delegate",
    });
    expect(fake.store.get(RESPONSE_PATH)!.attendeeCreated).toBe(true);
  });
});
