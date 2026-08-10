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

const {
  getAdminEmailDefinitionByKind,
  sendEventEmail,
  resolveEmailBlockRenderContext,
  loadEmailTemplateVariableSource,
  attachEmailTemplateVariables,
} = vi.hoisted(() => ({
  getAdminEmailDefinitionByKind: vi.fn(),
  sendEventEmail: vi.fn(),
  resolveEmailBlockRenderContext: vi.fn(),
  loadEmailTemplateVariableSource: vi.fn(),
  attachEmailTemplateVariables: vi.fn(),
}));

vi.mock("@/lib/db/adminEmailDefinition", () => ({
  getAdminEmailDefinitionByKind,
}));
vi.mock("@/lib/email/send-service", () => ({ sendEventEmail }));
// M6-T4 B-1: this hook now resolves live block-render context (pricing/
// registrationCta/countdown) before deriving the body — mocked at its own
// module boundary here (covered directly by
// email-block-render-context.test.ts) so this file stays focused on the
// trigger-firing behavior it already locks.
vi.mock("@/features/emails/server/resolve-block-context", () => ({
  resolveEmailBlockRenderContext,
}));
vi.mock("@/features/emails/server/template-variables", () => ({
  loadEmailTemplateVariableSource,
  attachEmailTemplateVariables,
}));

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
  resolveEmailBlockRenderContext.mockResolvedValue({});
  loadEmailTemplateVariableSource.mockResolvedValue({ values: {} });
  attachEmailTemplateVariables.mockImplementation(
    ({ context }: { context: unknown }) => context,
  );
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

describe("fireApprovalPendingEmail — M6-T4 B-1: live block-render context reaches the rendered HTML", () => {
  it("resolves the block context once per send and a CountdownTimer block renders the REAL target, not the completedMessage fallback", async () => {
    resolveEmailBlockRenderContext.mockResolvedValue({
      countdown: {
        eventStartIso: "2099-01-01T09:00:00.000Z",
        timezone: "UTC",
      },
    });
    getAdminEmailDefinitionByKind.mockResolvedValue({
      id: "def-1",
      kind: "approval-pending",
      subject: "s",
      body: "b",
      enabled: true,
      isSystem: true,
      bodyMode: "blocks",
      bodyBlocks: [
        {
          id: "cd-1",
          type: "CountdownTimer",
          props: { completedMessage: "The event has started." },
        },
      ],
    });

    await fireApprovalPendingEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      event: EVENT,
      submissionId: SUBMISSION_ID,
      submission: SUBMISSION,
    });

    expect(resolveEmailBlockRenderContext).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    const call = sendEventEmail.mock.calls[0][0];
    expect(call.template.bodyHtml).toContain("January 1, 2099");
    expect(call.template.bodyHtml).not.toContain("The event has started.");
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
