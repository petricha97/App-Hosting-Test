// @vitest-environment node
/**
 * M6-T3 — real-time `on-submit` trigger unit tests (spec:
 * agents/docs/specs/m6-lifecycle-triggers.md §1).
 * src/features/emails/server/fire-on-submit-email.ts +
 * src/features/emails/server/resolve-definition.ts.
 *
 * Locks:
 *  - fires approval-pending with dedupeKey = submissionId, recipient from
 *    the submission map;
 *  - a stored (materialized) definition's subject/body/enabled win over the
 *    in-code virtual default;
 *  - enabled is re-read at fire time — disabled skips silently, zero calls
 *    to sendEventEmail;
 *  - a sendEventEmail throw/reject never propagates (failure isolation).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminEmailDefinitionByKind, sendEventEmail } = vi.hoisted(() => ({
  getAdminEmailDefinitionByKind: vi.fn(),
  sendEventEmail: vi.fn(),
}));

vi.mock("@/lib/db/adminEmailDefinition", () => ({
  getAdminEmailDefinitionByKind,
}));
vi.mock("@/lib/email/send-service", () => ({ sendEventEmail }));

import { fireApprovalPendingEmail } from "@/features/emails/server/fire-on-submit-email";

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const SUBMISSION_ID = "sub-1";

const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [],
  timezone: "UTC",
};

const SUBMISSION = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  getAdminEmailDefinitionByKind.mockResolvedValue(null); // virtual default
  sendEventEmail.mockResolvedValue({
    ok: true,
    outcome: "sent",
    messageId: "msg-1",
    providerMessageId: "dev-1",
    renderReport: { usedTags: [], missingTags: [], unknownTags: [] },
  });
});

describe("fireApprovalPendingEmail — firing (spec §1)", () => {
  it("sends kind=approval-pending with dedupeKey=submissionId and the submission's recipient", async () => {
    await fireApprovalPendingEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      event: EVENT,
      submissionId: SUBMISSION_ID,
      submission: SUBMISSION,
    });

    expect(sendEventEmail).toHaveBeenCalledTimes(1);
    expect(sendEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        kind: "approval-pending",
        dedupeKey: SUBMISSION_ID,
        recipient: { name: "Ada Lovelace", email: "ada@example.com" },
        submissionId: SUBMISSION_ID,
      }),
    );
  });

  it("a stored definition's subject/body/enabled win over the virtual default", async () => {
    getAdminEmailDefinitionByKind.mockResolvedValue({
      id: "def-1",
      kind: "approval-pending",
      subject: "Custom subject",
      body: "Custom body {first_name}",
      enabled: true,
      isSystem: true,
    });

    await fireApprovalPendingEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      event: EVENT,
      submissionId: SUBMISSION_ID,
      submission: SUBMISSION,
    });

    expect(sendEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template: expect.objectContaining({
          subject: "Custom subject",
          bodyText: "Custom body {first_name}",
        }),
      }),
    );
  });

  it("two distinct submissions each get their own dedupeKey (never per-visitor)", async () => {
    await fireApprovalPendingEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      event: EVENT,
      submissionId: "sub-a",
      submission: SUBMISSION,
    });
    await fireApprovalPendingEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      event: EVENT,
      submissionId: "sub-b",
      submission: SUBMISSION,
    });

    expect(sendEventEmail).toHaveBeenCalledTimes(2);
    const [first, second] = sendEventEmail.mock.calls;
    expect(first[0].dedupeKey).toBe("sub-a");
    expect(second[0].dedupeKey).toBe("sub-b");
  });
});

describe("fireApprovalPendingEmail — enabled gate (spec §1 AC-3)", () => {
  it("skips silently (zero sendEventEmail calls) when the stored definition is disabled", async () => {
    getAdminEmailDefinitionByKind.mockResolvedValue({
      id: "def-1",
      kind: "approval-pending",
      subject: "s",
      body: "b",
      enabled: false,
      isSystem: true,
    });

    await fireApprovalPendingEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      event: EVENT,
      submissionId: SUBMISSION_ID,
      submission: SUBMISSION,
    });

    expect(sendEventEmail).not.toHaveBeenCalled();
  });

  it("re-reads enabled fresh on every call — never cached across calls", async () => {
    getAdminEmailDefinitionByKind.mockResolvedValueOnce({
      id: "def-1",
      kind: "approval-pending",
      subject: "s",
      body: "b",
      enabled: false,
      isSystem: true,
    });
    await fireApprovalPendingEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      event: EVENT,
      submissionId: "sub-a",
      submission: SUBMISSION,
    });
    expect(sendEventEmail).not.toHaveBeenCalled();

    getAdminEmailDefinitionByKind.mockResolvedValueOnce({
      id: "def-1",
      kind: "approval-pending",
      subject: "s",
      body: "b",
      enabled: true,
      isSystem: true,
    });
    await fireApprovalPendingEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      event: EVENT,
      submissionId: "sub-b",
      submission: SUBMISSION,
    });
    expect(sendEventEmail).toHaveBeenCalledTimes(1);
  });
});

describe("fireApprovalPendingEmail — failure isolation", () => {
  it("never throws when sendEventEmail rejects", async () => {
    sendEventEmail.mockRejectedValue(new Error("transport down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      fireApprovalPendingEmail({
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        event: EVENT,
        submissionId: SUBMISSION_ID,
        submission: SUBMISSION,
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("never throws when a typed rejection/failed outcome comes back", async () => {
    sendEventEmail.mockResolvedValue({
      ok: false,
      outcome: "rejected",
      code: "INVALID_RECIPIENT",
      message: "bad address",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      fireApprovalPendingEmail({
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        event: EVENT,
        submissionId: SUBMISSION_ID,
        submission: SUBMISSION,
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
