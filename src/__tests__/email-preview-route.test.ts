// @vitest-environment node
/**
 * M6-T2/M6-T4 — POST /api/dashboard/events/[eventId]/emails/preview
 * Spec §3: the editor's own live preview — per spec §3.2 the "authoritative"
 * surface an organizer is told to trust over the canvas.
 *
 * M6-T4 B-1 fix locks:
 *  - resolveEmailBlockRenderContext is called with {eventId, organizationId}
 *    on every request;
 *  - a RegistrationEmbed/TicketPricingTable/CountdownTimer block renders
 *    REAL data from that context, not the empty-state fallback, when the
 *    context resolves real data;
 *  - a resolution result of {} (context genuinely unavailable) still
 *    renders — the honest fallback, never a 500.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decodeUser,
  getAdminUserByEmail,
  getAdminEventForOrganization,
  listAdminAttendeesForEvent,
  resolveEmailBlockRenderContext,
  loadEmailTemplateVariableSource,
  attachEmailTemplateVariables,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decodeUser: vi.fn(),
  getAdminUserByEmail: vi.fn(),
  getAdminEventForOrganization: vi.fn(),
  listAdminAttendeesForEvent: vi.fn(),
  resolveEmailBlockRenderContext: vi.fn(),
  loadEmailTemplateVariableSource: vi.fn(),
  attachEmailTemplateVariables: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization }));
vi.mock("@/lib/db/adminAttendee", () => ({ listAdminAttendeesForEvent }));
// M6-T4 B-1: mocked at its own module boundary (covered directly by
// email-block-render-context.test.ts).
vi.mock("@/features/emails/server/resolve-block-context", () => ({
  resolveEmailBlockRenderContext,
}));
vi.mock("@/features/emails/server/template-variables", () => ({
  loadEmailTemplateVariableSource,
  attachEmailTemplateVariables,
}));

import { POST } from "@/app/api/dashboard/events/[eventId]/emails/preview/route";

const EVENT_ID = "evt-1";
const ORG_ID = "org-1";

const EVENT = {
  id: EVENT_ID,
  name: "Innovation Summit",
  periods: [],
  timezone: "UTC",
};

function previewRequest(body: unknown) {
  return new Request(
    `http://localhost/api/dashboard/events/${EVENT_ID}/emails/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function makeContext() {
  return { params: Promise.resolve({ eventId: EVENT_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookies.mockResolvedValue({
    get: (name: string) =>
      name === "session" ? { value: "token" } : undefined,
  });
  decodeUser.mockResolvedValue({
    uid: "u1",
    name: "Owner",
    picture: "",
    email: "owner@example.com",
  });
  getAdminUserByEmail.mockResolvedValue({
    organizationId: ORG_ID,
    organizations: [{ organizationId: ORG_ID, role: "owner" }],
    permissions: ["write:events"],
  });
  getAdminEventForOrganization.mockResolvedValue(EVENT);
  listAdminAttendeesForEvent.mockResolvedValue([]);
  resolveEmailBlockRenderContext.mockResolvedValue({});
  loadEmailTemplateVariableSource.mockResolvedValue({ values: {} });
  attachEmailTemplateVariables.mockImplementation(
    ({ context }: { context: unknown }) => context,
  );
});

describe("POST preview — plain-text mode (unchanged)", () => {
  it("renders subject/body against the sample context", async () => {
    const response = await POST(
      previewRequest({
        subject: "Hi {first_name}",
        body: "Welcome to {event_title}",
      }),
      makeContext(),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subject).toContain("Sample");
    expect(body.bodyHtml).toContain("Innovation Summit");
  });

  it("returns unknown variable warnings without breaking the rendered preview", async () => {
    attachEmailTemplateVariables.mockImplementation(
      ({ context }: { context: { firstName?: string } }) => ({
        ...context,
        variables: {},
      }),
    );

    const response = await POST(
      previewRequest({
        subject: "Hi {{RECIPIENT_NAME}}",
        body: "Welcome to {event_title}",
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subject).toContain("{{RECIPIENT_NAME}}");
    expect(body.unknownVariables).toEqual(["RECIPIENT_NAME"]);
  });
});

describe("POST preview — M6-T4 B-1: live block-render context reaches the rendered HTML", () => {
  it("passes {eventId, organizationId} to resolveEmailBlockRenderContext and a RegistrationEmbed block renders the REAL open-state link", async () => {
    resolveEmailBlockRenderContext.mockResolvedValue({
      registrationCta: {
        state: "open",
        registerHref: "https://app.example.com/events/evt-1/register",
      },
    });

    const response = await POST(
      previewRequest({
        subject: "s",
        body: "b",
        bodyMode: "blocks",
        bodyBlocks: [
          {
            id: "reg-1",
            type: "RegistrationEmbed",
            props: { title: "Register", body: "Join us", buttonLabel: "" },
          },
        ],
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect(resolveEmailBlockRenderContext).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    const body = await response.json();
    expect(body.bodyHtml).toContain(
      "https://app.example.com/events/evt-1/register",
    );
  });

  it("a genuinely empty context renders the honest fallback, never a 500", async () => {
    resolveEmailBlockRenderContext.mockResolvedValue({});

    const response = await POST(
      previewRequest({
        subject: "s",
        body: "b",
        bodyMode: "blocks",
        bodyBlocks: [
          {
            id: "tp-1",
            type: "TicketPricingTable",
            props: { title: "Tickets", intro: "", emptyMessage: "" },
          },
        ],
      }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.bodyHtml).toContain("Tickets will be announced soon.");
  });
});
