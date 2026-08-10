// @vitest-environment node
/**
 * M6-T3 — real-time `on-accept` trigger unit tests (spec:
 * agents/docs/specs/m6-lifecycle-triggers.md §2).
 * src/features/emails/server/fire-on-accept-email.ts.
 *
 * Locks (Shared-decisions discriminator):
 *  - paid / comped -> confirmation-paid; outstanding -> confirmation-
 *    payment-due; orderId null -> confirmation-paid (documented fallback);
 *  - enabled gates ONLY the selected kind — no fallback to the sibling kind
 *    when it's disabled;
 *  - dedupeKey = attendeeId;
 *  - a sendEventEmail / DAL throw never propagates (failure isolation) —
 *    the caller (onSubmissionAccepted) must be able to trust this never
 *    throws.
 */
import { FieldValue } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAdminOrderForEvent,
  getAdminEventForOrganization,
  getAdminEmailDefinitionByKind,
  sendEventEmail,
  resolveEmailBlockRenderContext,
  loadEmailTemplateVariableSource,
  attachEmailTemplateVariables,
} = vi.hoisted(() => ({
  getAdminOrderForEvent: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  getAdminEmailDefinitionByKind: vi.fn(),
  sendEventEmail: vi.fn(),
  resolveEmailBlockRenderContext: vi.fn(),
  loadEmailTemplateVariableSource: vi.fn(),
  attachEmailTemplateVariables: vi.fn(),
}));

vi.mock("@/lib/db/adminOrder", () => ({ getAdminOrderForEvent }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminEmailDefinition", () => ({
  getAdminEmailDefinitionByKind,
}));
vi.mock("@/lib/email/send-service", () => ({ sendEventEmail }));
// M6-T4 B-1: mocked at its own module boundary (covered directly by
// email-block-render-context.test.ts) — see email-lifecycle-on-submit.test.ts.
vi.mock("@/features/emails/server/resolve-block-context", () => ({
  resolveEmailBlockRenderContext,
}));
vi.mock("@/features/emails/server/template-variables", () => ({
  loadEmailTemplateVariableSource,
  attachEmailTemplateVariables,
}));

import { fireOnAcceptConfirmationEmail } from "@/features/emails/server/fire-on-accept-email";
import type { AttendeeDoc, WithId } from "@/types/collection";

const ORG_ID = "org-1";
const EVENT_ID = "evt-1";
const SUBMISSION_ID = "sub-1";
const ATTENDEE_ID = "attendee-1";

const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [],
  timezone: "UTC",
};

function attendee(
  overrides: Partial<WithId<AttendeeDoc>> = {},
): WithId<AttendeeDoc> {
  return {
    id: ATTENDEE_ID,
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    submissionId: SUBMISSION_ID,
    orderId: "order-1",
    pathId: "path-1",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    company: "Dentsu",
    jobTitle: "Engineer",
    registrationTypeId: "rt-1",
    registrationTypeLabel: "Delegate",
    ticketTypeId: "tick-1",
    ticketLabel: "VIP",
    status: "accepted",
    checkInState: "not-arrived",
    checkedInAt: null,
    checkedInBy: null,
    qrTokenHash: "hash",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...overrides,
  };
}

function order(paymentStatus: string) {
  return {
    id: "order-1",
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    currency: "USD",
    amounts: {
      subtotalMinor: 100,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 100,
    },
    paymentStatus,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAdminEventForOrganization.mockResolvedValue(EVENT);
  getAdminEmailDefinitionByKind.mockResolvedValue(null); // virtual defaults
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

describe("fireOnAcceptConfirmationEmail — kind selection (spec §2 discriminator)", () => {
  it("paid -> confirmation-paid", async () => {
    getAdminOrderForEvent.mockResolvedValue(order("paid"));
    await fireOnAcceptConfirmationEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: SUBMISSION_ID,
      attendee: attendee(),
    });
    expect(sendEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "confirmation-paid",
        dedupeKey: ATTENDEE_ID,
      }),
    );
  });

  it("comped -> confirmation-paid (not payment-due)", async () => {
    getAdminOrderForEvent.mockResolvedValue(order("comped"));
    await fireOnAcceptConfirmationEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: SUBMISSION_ID,
      attendee: attendee(),
    });
    expect(sendEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "confirmation-paid" }),
    );
  });

  it("outstanding -> confirmation-payment-due", async () => {
    getAdminOrderForEvent.mockResolvedValue(order("outstanding"));
    await fireOnAcceptConfirmationEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: SUBMISSION_ID,
      attendee: attendee(),
    });
    expect(sendEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "confirmation-payment-due",
        dedupeKey: ATTENDEE_ID,
      }),
    );
  });

  it("orderId: null -> confirmation-paid (documented fallback), never crashes on the missing order", async () => {
    await fireOnAcceptConfirmationEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: SUBMISSION_ID,
      attendee: attendee({ orderId: null }),
    });
    expect(getAdminOrderForEvent).not.toHaveBeenCalled();
    expect(sendEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "confirmation-paid" }),
    );
  });

  it("an unresolvable orderId (order doc gone) also falls back to confirmation-paid", async () => {
    getAdminOrderForEvent.mockResolvedValue(null);
    await fireOnAcceptConfirmationEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: SUBMISSION_ID,
      attendee: attendee(),
    });
    expect(sendEventEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "confirmation-paid" }),
    );
  });
});

describe("fireOnAcceptConfirmationEmail — enabled gate, no cross-kind fallback (spec §2)", () => {
  it("disabling the SELECTED kind sends zero emails, even though the sibling kind stays enabled", async () => {
    getAdminOrderForEvent.mockResolvedValue(order("paid"));
    getAdminEmailDefinitionByKind.mockImplementation(
      async ({ kind }: { kind: string }) => {
        if (kind === "confirmation-paid") {
          return {
            id: "def-paid",
            kind,
            subject: "s",
            body: "b",
            enabled: false,
            isSystem: true,
          };
        }
        return {
          id: "def-due",
          kind,
          subject: "s",
          body: "b",
          enabled: true,
          isSystem: true,
        };
      },
    );

    await fireOnAcceptConfirmationEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: SUBMISSION_ID,
      attendee: attendee(),
    });

    expect(sendEventEmail).not.toHaveBeenCalled();
  });
});

describe("fireOnAcceptConfirmationEmail — M6-T4 B-1: live block-render context reaches the rendered HTML", () => {
  it("resolves the block context once per send and a TicketPricingTable block renders REAL prices, not the empty-state message", async () => {
    getAdminOrderForEvent.mockResolvedValue(order("paid"));
    resolveEmailBlockRenderContext.mockResolvedValue({
      pricing: {
        currencies: ["USD"],
        tickets: [
          {
            name: "VIP Pass",
            code: "VIP",
            soldOut: false,
            audienceNames: [],
            prices: [{ currency: "USD", minPriceMinor: 25000, isFrom: false }],
          },
        ],
      },
    });
    getAdminEmailDefinitionByKind.mockResolvedValue({
      id: "def-paid",
      kind: "confirmation-paid",
      subject: "s",
      body: "b",
      enabled: true,
      isSystem: true,
      bodyMode: "blocks",
      bodyBlocks: [
        {
          id: "tp-1",
          type: "TicketPricingTable",
          props: { title: "Your ticket" },
        },
      ],
    });

    await fireOnAcceptConfirmationEmail({
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: SUBMISSION_ID,
      attendee: attendee(),
    });

    expect(resolveEmailBlockRenderContext).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    const call = sendEventEmail.mock.calls[0][0];
    expect(call.template.bodyHtml).toContain("VIP Pass");
    expect(call.template.bodyHtml).toContain("$250.00");
    expect(call.template.bodyHtml).not.toContain(
      "Tickets will be announced soon.",
    );
  });
});

describe("fireOnAcceptConfirmationEmail — failure isolation", () => {
  it("never throws when sendEventEmail rejects", async () => {
    getAdminOrderForEvent.mockResolvedValue(order("paid"));
    sendEventEmail.mockRejectedValue(new Error("transport down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      fireOnAcceptConfirmationEmail({
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        submissionId: SUBMISSION_ID,
        attendee: attendee(),
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("never throws when a DAL lookup (order/event) rejects", async () => {
    getAdminOrderForEvent.mockRejectedValue(new Error("firestore blip"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      fireOnAcceptConfirmationEmail({
        organizationId: ORG_ID,
        eventId: EVENT_ID,
        submissionId: SUBMISSION_ID,
        attendee: attendee(),
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    expect(sendEventEmail).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
