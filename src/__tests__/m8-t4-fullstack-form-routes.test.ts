// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(), decodeUser: vi.fn(), getUser: vi.fn(), getEvent: vi.fn(),
  getForm: vi.fn(), createForm: vi.fn(), updateForm: vi.fn(), updateEvent: vi.fn(),
  detach: vi.fn(), createFormData: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: mocks.decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail: mocks.getUser }));
vi.mock("@/lib/db/adminEvent", () => ({
  getAdminEventForOrganization: mocks.getEvent, updateAdminEvent: mocks.updateEvent,
}));
vi.mock("@/lib/db/adminForm", () => ({
  getAdminFormForEvent: mocks.getForm, createAdminForm: mocks.createForm,
  updateAdminForm: mocks.updateForm, detachAdminFormFromTemplate: mocks.detach,
}));
vi.mock("@/lib/db/adminFormData", () => ({ createAdminFormData: mocks.createFormData }));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "NOW" } }));

const { POST: save } = await import("@/app/api/dashboard/events/[eventId]/form/route");
const { POST: detach } = await import("@/app/api/dashboard/events/[eventId]/form/detach/route");
const { POST: submit } = await import("@/app/api/dashboard/events/[eventId]/form/submit/route");

const context = (eventId = "event-a") => ({ params: Promise.resolve({ eventId }) });
const request = (body: unknown) => new Request("http://localhost/form", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const field = { id: "email", key: "email", label: "Email", type: "email", required: true };
const fields = [
  { id: "firstName", key: "firstName", label: "First name", type: "text", required: true },
  { id: "lastName", key: "lastName", label: "Last name", type: "text", required: true },
  field,
];
const form = { id: "form-a", eventId: "event-a", organizationId: "org-a", title: "Registration", status: "published", fields: [field], templateLink: { templateId: "tpl-a", templateVersion: 1, detached: false, appliedAt: "OLD" } };

function signedIn(permissions = ["write:form"], organizationId = "org-a") {
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "token" }) });
  mocks.decodeUser.mockResolvedValue({ email: "USER@EXAMPLE.COM", uid: "uid-a" });
  mocks.getUser.mockResolvedValue({ organizationId, permissions });
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset()); signedIn();
  mocks.getEvent.mockResolvedValue({ id: "event-a", name: "Event A", organizationPath: "Organization/org-a", formPath: "Form/form-a" });
  mocks.getForm.mockResolvedValue(form); mocks.createForm.mockResolvedValue("form-new");
  mocks.createFormData.mockResolvedValue("submission-a");
});

describe("M8-T4 event form save POST", () => {
  it("rejects a missing session and missing write:form without writes", async () => {
    mocks.cookies.mockResolvedValueOnce({ get: () => undefined });
    expect((await save(request({}), context())).status).toBe(401);
    signedIn([], "org-a");
    expect((await save(request({}), context())).status).toBe(403);
    expect(mocks.getEvent).not.toHaveBeenCalled();
    expect(mocks.createForm).not.toHaveBeenCalled();
    expect(mocks.updateForm).not.toHaveBeenCalled();
  });

  it("rejects a foreign-org event and malformed builder data with no form/event write", async () => {
    mocks.getEvent.mockResolvedValueOnce(null);
    expect((await save(request({ title: "X", status: "draft", fields: [] }), context("event-b"))).status).toBe(404);
    expect(mocks.getEvent).toHaveBeenCalledWith("event-b", "org-a");
    mocks.getEvent.mockResolvedValueOnce({ id: "event-a", name: "A" });
    expect((await save(request({ title: "", status: "draft", fields: [] }), context())).status).toBe(400);
    expect(mocks.createForm).not.toHaveBeenCalled();
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });

  it("creates a tenant-stamped form and only then points the event at it", async () => {
    mocks.getForm.mockResolvedValueOnce(null);
    const response = await save(request({ title: " Registration ", status: "published", fields }), context());
    expect(response.status).toBe(200);
    expect(mocks.createForm).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-a", organizationId: "org-a", title: "Registration" }));
    expect(mocks.updateEvent).toHaveBeenCalledWith("event-a", expect.objectContaining({ formPath: "Form/form-new" }));
  });

  it("updates only the scoped existing form and preserves its tenant ids", async () => {
    const response = await save(request({ title: "Updated", status: "draft", fields }), context());
    expect(response.status).toBe(200);
    expect(mocks.updateForm).toHaveBeenCalledWith("form-a", expect.objectContaining({ eventId: "event-a", organizationId: "org-a", title: "Updated" }));
    expect(mocks.createForm).not.toHaveBeenCalled();
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });
});

describe("M8-T4 event form detach POST", () => {
  it("denies missing permission and a foreign event/form without detaching", async () => {
    signedIn([]);
    expect((await detach(request({}), context())).status).toBe(403);
    signedIn(); mocks.getEvent.mockResolvedValueOnce(null);
    expect((await detach(request({}), context("event-b"))).status).toBe(404);
    mocks.getEvent.mockResolvedValueOnce({ name: "A", formPath: "Form/form-a" }); mocks.getForm.mockResolvedValueOnce(null);
    expect((await detach(request({}), context())).status).toBe(404);
    expect(mocks.detach).not.toHaveBeenCalled();
  });

  it("detaches exactly the same-org form resolved through the scoped event", async () => {
    const response = await detach(request({}), context());
    expect(response.status).toBe(200);
    expect(mocks.getForm).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-a", organizationId: "org-a" }));
    expect(mocks.detach).toHaveBeenCalledWith({ form });
  });
});

describe("M8-T4 event form submit POST", () => {
  it("cannot submit against another organization's event or form", async () => {
    mocks.getEvent.mockResolvedValueOnce(null);
    expect((await submit(request({ submission: { email: "a@b.co" } }), context("event-b"))).status).toBe(404);
    mocks.getEvent.mockResolvedValueOnce({ name: "A", formPath: "Form/form-b" }); mocks.getForm.mockResolvedValueOnce(null);
    expect((await submit(request({ submission: { email: "a@b.co" } }), context())).status).toBe(404);
    expect(mocks.createFormData).not.toHaveBeenCalled();
  });

  it("rejects invalid dynamic-field input without a write", async () => {
    const response = await submit(request({ submission: { email: "not-email" } }), context());
    expect(response.status).toBe(400);
    expect(mocks.createFormData).not.toHaveBeenCalled();
  });

  it("writes a validated submission with server-derived tenant identity", async () => {
    const response = await submit(request({ submission: { email: "ada@example.com" } }), context());
    expect(response.status).toBe(200);
    expect(mocks.createFormData).toHaveBeenCalledWith({ formId: "form-a", eventId: "event-a", organizationId: "org-a", submission: { email: "ada@example.com" }, submittedAt: "NOW" });
  });
});
