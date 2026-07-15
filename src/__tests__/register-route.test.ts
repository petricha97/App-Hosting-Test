// @vitest-environment node
/**
 * M0-T4 characterization tests — behaviors 7 & 8.
 *
 * Locks the POST /api/events/[eventId]/register gates:
 *  7. 404 when the event is missing or Draft (published gate); 404
 *     "Registration is not available yet" when no published form; 400 with a
 *     flattened Zod error for a non-record body or a submission failing the
 *     dynamically built schema.
 *  8. Happy path: createAdminFormData receives formId, eventId, organizationId
 *     (from the form, falling back to the event's organizationPath), the
 *     parsed submission, and the server timestamp; responds { submissionId }.
 *
 * The DAL is mocked at the module boundary — no emulator required.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import { formFieldSchema } from "@/features/form/schema";

const {
  getAdminPublishedEventById,
  getAdminPublishedFormForPublicEvent,
  createAdminFormData,
  fireApprovalPendingEmail,
} = vi.hoisted(() => ({
  getAdminPublishedEventById: vi.fn(),
  getAdminPublishedFormForPublicEvent: vi.fn(),
  createAdminFormData: vi.fn(),
  fireApprovalPendingEmail: vi.fn(),
}));

vi.mock("@/lib/db/adminEvent", () => ({ getAdminPublishedEventById }));
vi.mock("@/lib/db/adminForm", () => ({ getAdminPublishedFormForPublicEvent }));
vi.mock("@/lib/db/adminFormData", () => ({ createAdminFormData }));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" },
}));
// M6-T3: the on-submit trigger module — mocked at the boundary (the real
// module would otherwise touch Firestore for real, since this file never
// mocks the email DAL).
vi.mock("@/features/emails/server/fire-on-submit-email", () => ({
  fireApprovalPendingEmail,
}));

import { POST } from "@/app/api/events/[eventId]/register/route";

const EVENT_ID = "evt-1";

const publishedEvent = {
  id: EVENT_ID,
  name: "Tech Meetup 2026",
  status: "Published",
  organizationPath: "Organization/org-1",
  formPath: "Form/form-1",
};

function makeFormField(
  overrides: Partial<Parameters<typeof formFieldSchema.parse>[0]>,
) {
  return formFieldSchema.parse({
    id: overrides.key ?? "field",
    key: "field",
    label: "Field",
    type: "text",
    ...overrides,
  });
}

const formFields = [
  makeFormField({ key: "firstName", label: "First name", required: true }),
  makeFormField({ key: "lastName", label: "Last name", required: true }),
  makeFormField({
    key: "email",
    label: "Email",
    type: "email",
    required: true,
  }),
];

function makeForm(overrides: Record<string, unknown> = {}) {
  return {
    id: "form-1",
    eventId: EVENT_ID,
    organizationId: "org-form",
    title: "Registration",
    status: "published",
    fields: formFields,
    ...overrides,
  };
}

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/events/${EVENT_ID}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeContext(eventId = EVENT_ID) {
  return { params: Promise.resolve({ eventId }) };
}

beforeEach(() => {
  getAdminPublishedEventById.mockReset();
  getAdminPublishedFormForPublicEvent.mockReset();
  createAdminFormData.mockReset();
  fireApprovalPendingEmail.mockReset();
});

describe("POST /api/events/[eventId]/register — gates", () => {
  it("returns 404 when the event is missing or Draft (published gate resolves null)", async () => {
    getAdminPublishedEventById.mockResolvedValue(null);

    const response = await POST(makeRequest({ submission: {} }), makeContext());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Event not found",
    });
    expect(getAdminPublishedFormForPublicEvent).not.toHaveBeenCalled();
    expect(createAdminFormData).not.toHaveBeenCalled();
  });

  it("returns 404 when the event has no published form", async () => {
    getAdminPublishedEventById.mockResolvedValue(publishedEvent);
    getAdminPublishedFormForPublicEvent.mockResolvedValue(null);

    const response = await POST(makeRequest({ submission: {} }), makeContext());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Registration is not available yet",
    });
    expect(createAdminFormData).not.toHaveBeenCalled();
  });

  it("returns 400 with a flattened Zod error when the body is not a submission record", async () => {
    getAdminPublishedEventById.mockResolvedValue(publishedEvent);
    getAdminPublishedFormForPublicEvent.mockResolvedValue(makeForm());

    const response = await POST(
      makeRequest({ submission: "not-a-record" }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBeDefined();
    expect(payload.error.fieldErrors.submission).toBeDefined();
    expect(createAdminFormData).not.toHaveBeenCalled();
  });

  it("returns 400 when the submission fails the dynamically built form schema", async () => {
    getAdminPublishedEventById.mockResolvedValue(publishedEvent);
    getAdminPublishedFormForPublicEvent.mockResolvedValue(makeForm());

    const response = await POST(
      makeRequest({
        submission: { firstName: "   ", lastName: "Lovelace", email: "a@b.co" },
      }),
      makeContext(),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.fieldErrors.firstName).toContain(
      "First name is required",
    );
    expect(createAdminFormData).not.toHaveBeenCalled();
  });
});

describe("POST /api/events/[eventId]/register — happy path", () => {
  const validSubmission = {
    firstName: "  Ada  ",
    lastName: "Lovelace",
    email: "ada@example.com",
  };

  it("creates the submission with the form's organizationId and responds with the id", async () => {
    getAdminPublishedEventById.mockResolvedValue(publishedEvent);
    getAdminPublishedFormForPublicEvent.mockResolvedValue(makeForm());
    createAdminFormData.mockResolvedValue("sub-1");

    const response = await POST(
      makeRequest({ submission: validSubmission }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ submissionId: "sub-1" });

    expect(createAdminFormData).toHaveBeenCalledTimes(1);
    expect(createAdminFormData).toHaveBeenCalledWith({
      formId: "form-1",
      eventId: EVENT_ID,
      organizationId: "org-form",
      submission: {
        // Values pass through the built schema, so they arrive trimmed.
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
      },
      submittedAt: "SERVER_TIMESTAMP",
    });
  });

  it("falls back to the event organizationPath when the form has no organizationId", async () => {
    getAdminPublishedEventById.mockResolvedValue(publishedEvent);
    getAdminPublishedFormForPublicEvent.mockResolvedValue(
      makeForm({ organizationId: "" }),
    );
    createAdminFormData.mockResolvedValue("sub-2");

    const response = await POST(
      makeRequest({ submission: validSubmission }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect(createAdminFormData).toHaveBeenCalledWith(
      expect.objectContaining({
        // extractOrganizationIdFromPath("Organization/org-1") → "org-1"
        organizationId: "org-1",
      }),
    );
  });
});

describe("POST /api/events/[eventId]/register — M6-T3 on-submit trigger (spec m6-lifecycle-triggers §1)", () => {
  const validSubmission = {
    firstName: "  Ada  ",
    lastName: "Lovelace",
    email: "ada@example.com",
  };

  it("fires approval-pending exactly once, keyed on the fresh submissionId (legacy flow has no replay path)", async () => {
    getAdminPublishedEventById.mockResolvedValue(publishedEvent);
    getAdminPublishedFormForPublicEvent.mockResolvedValue(makeForm());
    createAdminFormData.mockResolvedValue("sub-1");

    const response = await POST(
      makeRequest({ submission: validSubmission }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect(fireApprovalPendingEmail).toHaveBeenCalledTimes(1);
    expect(fireApprovalPendingEmail).toHaveBeenCalledWith({
      organizationId: "org-form",
      eventId: EVENT_ID,
      event: publishedEvent,
      submissionId: "sub-1",
      submission: {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
      },
    });
  });

  it("an email-hook crash never fails the registration response (isolation)", async () => {
    getAdminPublishedEventById.mockResolvedValue(publishedEvent);
    getAdminPublishedFormForPublicEvent.mockResolvedValue(makeForm());
    createAdminFormData.mockResolvedValue("sub-1");
    fireApprovalPendingEmail.mockRejectedValueOnce(new Error("boom"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const response = await POST(
      makeRequest({ submission: validSubmission }),
      makeContext(),
    );

    expect(response.status).toBe(200);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
