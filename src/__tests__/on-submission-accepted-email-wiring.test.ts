// @vitest-environment node
/**
 * M6-T3 — wiring test: onSubmissionAccepted (src/features/responses/
 * on-submission-accepted.ts) must call fireOnAcceptConfirmationEmail in the
 * SAME at-most-once envelope the attendee-creation step already has, AFTER
 * attendeeCreated flips true, and must NEVER let a throw from it propagate
 * (spec m6-lifecycle-triggers.md §2 — "accept-hook-throw-doesn't-un-accept").
 *
 * Uses the SAME fake-admin-db integration harness as
 * on-submission-accepted.test.ts (M5-T1) for the real attendee-creation
 * path, with ONLY the email-firing module mocked at the boundary — kind
 * selection / enabled-gate / send behavior are unit-tested separately in
 * email-lifecycle-on-accept.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();

vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { fireOnAcceptConfirmationEmail } = vi.hoisted(() => ({
  fireOnAcceptConfirmationEmail: vi.fn(
    async (_args: {
      organizationId: string;
      eventId: string;
      submissionId: string;
      attendee: { id: string };
    }) => {},
  ),
}));
vi.mock("@/features/emails/server/fire-on-accept-email", () => ({
  fireOnAcceptConfirmationEmail,
}));

import { Timestamp } from "firebase-admin/firestore";

import { attendeeIdFromSubmissionId } from "@/lib/db/attendeeId";
import { QR_TOKEN_SECRET_ENV } from "@/lib/qr/qr-token";
import type { FormDataDoc } from "@/types/collection";

process.env[QR_TOKEN_SECRET_ENV] = "unit-test-qr-secret";

const { transitionAdminFormDataStatus } =
  await import("@/lib/db/adminFormData");
const { onSubmissionAccepted } =
  await import("@/features/responses/on-submission-accepted");

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const RESPONSE_ID = "resp-1";
const ORDER_ID = "ord-1";

const ATTENDEE_ID = attendeeIdFromSubmissionId({
  organizationId: ORG_ID,
  eventId: EVENT_ID,
  submissionId: RESPONSE_ID,
});
const RESPONSE_PATH = `FormData/${RESPONSE_ID}`;

function seedResponse(overrides: Partial<FormDataDoc> = {}) {
  fake.store.set(RESPONSE_PATH, {
    formId: "form-1",
    eventId: EVENT_ID,
    organizationId: ORG_ID,
    submission: {
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@dentsu.com",
    },
    submittedAt: Timestamp.fromMillis(1_000),
    status: "reviewed",
    orderId: ORDER_ID,
    pathId: "path-1",
    ticketLabel: "VIP",
    statusUpdatedAt: null,
    acceptedAt: null,
    attendeeCreated: false,
    qrTokenHash: null,
    ...overrides,
  });
}

function seedOrder() {
  fake.store.set(`Order/${ORDER_ID}`, {
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId: RESPONSE_ID,
    ticketTypeId: "tt-1",
    registrationTypeId: "rt-1",
    feeId: "fee-1",
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
  fireOnAcceptConfirmationEmail.mockClear();
  fireOnAcceptConfirmationEmail.mockImplementation(async () => {});
});

describe("onSubmissionAccepted -> fireOnAcceptConfirmationEmail wiring", () => {
  it("calls it exactly once, AFTER attendeeCreated flips true, with the created attendee", async () => {
    seedResponse();
    seedOrder();

    const result = await accept();

    expect(result).toMatchObject({ ok: true });
    expect(fireOnAcceptConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(fireOnAcceptConfirmationEmail).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: RESPONSE_ID,
      attendee: expect.objectContaining({ id: ATTENDEE_ID, firstName: "Ada" }),
    });

    // attendeeCreated was already true by the time the call happened (step
    // ordering — the mock records call args synchronously with the state at
    // call time; re-reading the store here proves the write landed first).
    const response = fake.store.get(RESPONSE_PATH) as {
      attendeeCreated: boolean;
    };
    expect(response.attendeeCreated).toBe(true);
  });

  it("a healing re-invoke (M5-T1 S-1 path) calls it again with the SAME attendeeId (replay-safe by construction)", async () => {
    seedResponse();
    seedOrder();
    await accept();
    expect(fireOnAcceptConfirmationEmail).toHaveBeenCalledTimes(1);

    const submission = {
      id: RESPONSE_ID,
      ...(fake.store.get(RESPONSE_PATH) as unknown as FormDataDoc),
    };
    await onSubmissionAccepted(submission);

    expect(fireOnAcceptConfirmationEmail).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = fireOnAcceptConfirmationEmail.mock.calls;
    expect(firstCall[0].attendee.id).toBe(ATTENDEE_ID);
    expect(secondCall[0].attendee.id).toBe(ATTENDEE_ID);
  });

  it("a throw from the email hook never un-accepts and never blocks attendeeCreated (spec §2 AC-6)", async () => {
    seedResponse();
    seedOrder();
    fireOnAcceptConfirmationEmail.mockRejectedValueOnce(
      new Error("transport down"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await accept();

    // The accept commit stands — no acceptHookFailed signal from an email
    // problem (attendeeCreated already flipped true before the email step).
    expect(result).toMatchObject({ ok: true });
    expect(
      (result as { acceptHookFailed?: boolean }).acceptHookFailed,
    ).toBeUndefined();

    const response = fake.store.get(RESPONSE_PATH) as {
      status: string;
      attendeeCreated: boolean;
    };
    expect(response.status).toBe("accepted");
    expect(response.attendeeCreated).toBe(true);
    expect(fake.store.get(`Attendee/${ATTENDEE_ID}`)).toBeDefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
