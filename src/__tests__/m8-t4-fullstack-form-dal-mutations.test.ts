// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAdminDb } from "./helpers/fake-admin-db";
import type { FormDoc, FormTemplateDoc } from "@/types/collection";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { detachAdminFormFromTemplate, applyAdminTemplateToForms, getAdminFormForEvent, getAdminPublishedFormForPublicEvent } = await import("@/lib/db/adminForm");
const { markAdminFormDataAttendeeCreated } = await import("@/lib/db/adminFormData");

const now = { seconds: 1, nanoseconds: 0 };
const emailField = { id: "email", key: "email", label: "Email", type: "email" as const, placeholder: "", helpText: "", required: true, isMandatory: true, order: 0, origin: "mandatory" as const };
const customField = { id: "diet", key: "diet", label: "Diet", type: "text" as const, placeholder: "", helpText: "", required: false, isMandatory: false, order: 1, origin: "event" as const };
const linkedField = { id: "linked-company", key: "company", label: "Old company", type: "text" as const, placeholder: "", helpText: "", required: false, isMandatory: false, order: 1, origin: "template" as const, sourceTemplateFieldId: "company" };
const eventDoc = (organizationId: string) => ({ name: "Event", description: "Description", capacity: 10, expectedGuests: 1, formPath: "Form/form", invoicePath: "", organizationPath: `Organization/${organizationId}`, timezone: "UTC", allowOverlap: false, status: "Draft", pageMode: "default", redirectUrl: "", periods: [], createdAt: now, updatedAt: now });

beforeEach(() => fake.reset());

describe("M8-T4 detachAdminFormFromTemplate", () => {
  it("changes only link/field origin metadata while preserving unrelated form content", async () => {
    const form = { id: "form-a", eventId: "event-a", organizationId: "org-a", title: "Keep title", status: "published" as const, fields: [emailField, linkedField, customField], templateLink: { templateId: "tpl-a", templateVersion: 3, detached: false, appliedAt: now }, createdAt: now, updatedAt: now } as unknown as FormDoc & { id: string };
    fake.store.set("Form/form-a", form as unknown as Record<string, unknown>);
    await detachAdminFormFromTemplate({ form });
    const stored = fake.store.get("Form/form-a")!;
    expect(stored).toMatchObject({ eventId: "event-a", organizationId: "org-a", title: "Keep title", status: "published", createdAt: now, templateLink: { templateId: "tpl-a", templateVersion: 3, detached: true } });
    expect((stored.fields as Array<Record<string, unknown>>).find((f) => f.id === "linked-company")).toMatchObject({ origin: "event", isMandatory: false });
    expect((stored.fields as Array<Record<string, unknown>>).find((f) => f.id === "diet")).toMatchObject({ label: "Diet", origin: "event" });
  });
});

describe("M8-T4 applyAdminTemplateToForms", () => {
  it("updates all explicitly supplied, already-scoped linked forms with template version/fields", async () => {
    const template = { id: "tpl-a", organizationId: "org-a", title: "Template", description: "", status: "active" as const, version: 4, fields: [{ ...linkedField, id: "company", label: "New company", origin: "template" as const, sourceTemplateFieldId: "company" }], createdAt: now, updatedAt: now } as unknown as FormTemplateDoc & { id: string };
    const forms = ["one", "two"].map((id) => ({ id, eventId: `event-${id}`, organizationId: "org-a", title: id, status: "draft" as const, fields: [linkedField, customField], templateLink: { templateId: "tpl-a", templateVersion: 3, detached: false, appliedAt: now }, createdAt: now, updatedAt: now })) as unknown as Array<FormDoc & { id: string }>;
    forms.forEach((form) => fake.store.set(`Form/${form.id}`, form as unknown as Record<string, unknown>));
    forms.forEach((form) => fake.store.set(`Event/${form.eventId}`, eventDoc("org-a")));
    fake.store.set("Form/unrelated", { ...forms[0], id: undefined, title: "untouched" });
    expect(await applyAdminTemplateToForms({ template, forms })).toEqual(["one", "two"]);
    for (const id of ["one", "two"]) {
      const stored = fake.store.get(`Form/${id}`)!;
      expect(stored).toMatchObject({ organizationId: "org-a", title: id, templateLink: { templateId: "tpl-a", templateVersion: 4, detached: false } });
      expect(stored.fields).toEqual(expect.arrayContaining([expect.objectContaining({ label: "New company", origin: "template" }), expect.objectContaining({ id: "diet", label: "Diet" })]));
    }
    expect(fake.store.get("Form/unrelated")).toMatchObject({ title: "untouched" });
  });

  it("P1 HIGH: rejects detached and foreign-organization forms instead of updating every caller-supplied form", async () => {
    const template = { id: "tpl-a", organizationId: "org-a", version: 4, fields: [] } as unknown as FormTemplateDoc & { id: string };
    const linked = { id: "linked", organizationId: "org-a", fields: [], templateLink: { templateId: "tpl-a", detached: false } } as unknown as FormDoc & { id: string };
    const detached = { ...linked, id: "detached", templateLink: { ...linked.templateLink!, detached: true } };
    const foreign = { ...linked, id: "foreign", organizationId: "org-b" };
    for (const form of [linked, detached, foreign]) {
      fake.store.set(`Form/${form.id}`, form as unknown as Record<string, unknown>);
    }

    const before = new Map([...fake.store.entries()].filter(([path]) => path.startsWith("Form/")));
    const writesBefore = fake.writes.length;

    await expect(
      applyAdminTemplateToForms({ template, forms: [linked, detached, foreign] }),
    ).rejects.toThrow("ineligible form");
    for (const [path, document] of before) expect(fake.store.get(path)).toEqual(document);
    expect(fake.writes).toHaveLength(writesBefore);
  });

  it("rejects an otherwise eligible form whose target event is not owned by the template organization", async () => {
    const template = { id: "tpl-a", organizationId: "org-a", version: 4, fields: [] } as unknown as FormTemplateDoc & { id: string };
    const form = { id: "linked", eventId: "event-b", organizationId: "org-a", fields: [], templateLink: { templateId: "tpl-a", detached: false } } as unknown as FormDoc & { id: string };
    fake.store.set("Form/linked", form as unknown as Record<string, unknown>);
    fake.store.set("Event/event-b", eventDoc("org-b"));
    await expect(applyAdminTemplateToForms({ template, forms: [form] })).rejects.toThrow("ineligible form");
    expect(fake.writes).toHaveLength(0);
  });
});

describe("M8-T4 getAdminPublishedFormForPublicEvent", () => {
  it("rejects a direct-match published form whose raw stored organization belongs to another tenant", async () => {
    fake.store.set("Form/foreign-direct", { eventId: "event-a", organizationId: "org-b", title: "Foreign", status: "published", fields: [emailField], createdAt: now, updatedAt: now });
    await expect(getAdminPublishedFormForPublicEvent({ eventId: "event-a", eventName: "Owned", organizationId: "org-a" })).resolves.toBeNull();
  });

  it("P0 BLOCKER: rejects a pre-existing formPath to another event and organization using the linked form's stored ownership", async () => {
    fake.store.set("Form/foreign", { eventId: "event-b", organizationId: "org-b", title: "Foreign", status: "published", fields: [emailField], createdAt: now, updatedAt: now });
    await expect(getAdminPublishedFormForPublicEvent({ eventId: "event-a", eventName: "Owned", organizationId: "org-a", formPath: "Form/foreign" })).resolves.toBeNull();
  });
});

describe("M8-T4 getAdminFormForEvent raw ownership", () => {
  it("rejects a direct-match candidate whose raw stored organization belongs to another tenant", async () => {
    fake.store.set("Form/foreign-direct", { eventId: "event-a", organizationId: "org-b", title: "Foreign", status: "draft", fields: [emailField], createdAt: now, updatedAt: now });
    await expect(getAdminFormForEvent({ eventId: "event-a", eventName: "Owned", organizationId: "org-a" })).resolves.toBeNull();
  });

  it("rejects a formPath pointer whose raw stored event and organization do not match the request", async () => {
    fake.store.set("Form/foreign-pointer", { eventId: "event-b", organizationId: "org-b", title: "Foreign", status: "draft", fields: [emailField], createdAt: now, updatedAt: now });
    await expect(getAdminFormForEvent({ eventId: "event-a", eventName: "Owned", organizationId: "org-a", formPath: "Form/foreign-pointer" })).resolves.toBeNull();
  });
});

describe("M8-T4 markAdminFormDataAttendeeCreated", () => {
  it("is idempotent and preserves unrelated submission/lifecycle data", async () => {
    const original = { formId: "form-a", eventId: "event-a", organizationId: "org-a", submission: { email: "ada@example.com" }, submittedAt: now, status: "accepted", attendeeCreated: false, attendeeId: "attendee-a", qrTokenHash: "existing-hash", orderId: "order-a" };
    fake.store.set("FormData/sub-a", original);
    await markAdminFormDataAttendeeCreated({ formDataId: "sub-a" });
    await markAdminFormDataAttendeeCreated({ formDataId: "sub-a" });
    expect(fake.store.get("FormData/sub-a")).toEqual({ ...original, attendeeCreated: true });
  });

  it("backfills the supplied legacy QR hash without overwriting other fields", async () => {
    fake.store.set("FormData/legacy", { formId: "form-a", eventId: "event-a", organizationId: "org-a", submission: { name: "Ada" }, attendeeCreated: false });
    await markAdminFormDataAttendeeCreated({ formDataId: "legacy", qrTokenHash: "new-hash" });
    expect(fake.store.get("FormData/legacy")).toEqual({ formId: "form-a", eventId: "event-a", organizationId: "org-a", submission: { name: "Ada" }, attendeeCreated: true, qrTokenHash: "new-hash" });
  });
});
