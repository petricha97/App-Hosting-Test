// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const save = vi.fn();
  const file = vi.fn(() => ({ save }));
  const bucket = { name: "test-bucket", file };
  return { cookies: vi.fn(), decodeUser: vi.fn(), getUser: vi.fn(), getEvent: vi.fn(), updateEvent: vi.fn(), getPage: vi.fn(), updateOrg: vi.fn(), updateUser: vi.fn(), bucketFn: vi.fn(() => bucket), bucket, file, save };
});
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth-utils", () => ({ default: mocks.decodeUser }));
vi.mock("@/lib/db/adminUser", () => ({ getAdminUserByEmail: mocks.getUser, updateAdminUser: mocks.updateUser }));
vi.mock("@/lib/db/adminEvent", () => ({ getAdminEventForOrganization: mocks.getEvent, updateAdminEvent: mocks.updateEvent }));
vi.mock("@/lib/db/adminEventPage", () => ({ getAdminEventPageForEvent: mocks.getPage }));
vi.mock("@/lib/db/adminOrganization", () => ({ updateAdminOrganization: mocks.updateOrg }));
vi.mock("@/app/lib/firestore", () => ({ adminStorage: { bucket: mocks.bucketFn } }));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "NOW" } }));

const { POST: updateEvent } = await import("@/app/api/dashboard/events/[eventId]/route");
const { POST: uploadAsset } = await import("@/app/api/dashboard/events/[eventId]/page/assets/route");
const { POST: uploadLogo } = await import("@/app/api/dashboard/settings/organization/logo/route");
const { POST: uploadAvatar } = await import("@/app/api/dashboard/settings/profile/avatar/route");

const context = (eventId = "event-a") => ({ params: Promise.resolve({ eventId }) });
function json(body: unknown) { return new Request("http://localhost/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
function multipart(file?: File, extra?: [string, string]) { const fd = new FormData(); if (file) fd.set("file", file); if (extra) fd.set(...extra); return new Request("http://localhost/upload", { method: "POST", body: fd }); }
function signIn(permissions: string[], organizationId = "org-a") {
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "token" }) });
  mocks.decodeUser.mockResolvedValue({ email: "Owner@Example.com", uid: "uid-a" });
  mocks.getUser.mockResolvedValue({ organizationId, permissions });
}
const range = { startDate: "2099-01-01", startTime: "09:00", endDate: "2099-01-01", endTime: "10:00" };
const validEvent = { name: "Summit", description: "Description", capacity: 100, expectedGuests: 50, formPath: "Form/form-a", invoicePath: "", organizationPath: "Organization/org-a", timezone: "UTC", allowOverlap: false, status: "Draft", pageMode: "default", redirectUrl: "", registrationPeriod: range, periods: [range] };

beforeEach(() => {
  [mocks.cookies, mocks.decodeUser, mocks.getUser, mocks.getEvent, mocks.updateEvent, mocks.getPage, mocks.updateOrg, mocks.updateUser, mocks.bucketFn, mocks.file, mocks.save].forEach((mock) => mock.mockReset());
  mocks.bucketFn.mockReturnValue(mocks.bucket); mocks.file.mockReturnValue({ save: mocks.save });
  signIn(["write:events", "write:organization"]);
  mocks.getEvent.mockResolvedValue({ id: "event-a", name: "Summit", organizationPath: "Organization/org-a", formPath: "Form/form-a", invoicePath: "", eventPagePath: undefined });
  mocks.getPage.mockResolvedValue(null);
});

describe("M8-T4 dashboard event POST", () => {
  it("requires authentication", async () => {
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    expect((await updateEvent(json(validEvent), context())).status).toBe(401);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });
  it("is permission-gated and does not write", async () => {
    signIn([]);
    expect((await updateEvent(json(validEvent), context())).status).toBe(403);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });
  it("cannot target a foreign organization's event", async () => {
    mocks.getEvent.mockResolvedValueOnce(null);
    expect((await updateEvent(json(validEvent), context("event-b"))).status).toBe(404);
    expect(mocks.getEvent).toHaveBeenCalledWith("event-b", "org-a");
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });
  it("rejects malformed event input without writing", async () => {
    expect((await updateEvent(json({ ...validEvent, name: "" }), context())).status).toBe(400);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });
  it("updates the scoped event with valid same-org input", async () => {
    const response = await updateEvent(json(validEvent), context());
    expect(response.status).toBe(200);
    expect(mocks.updateEvent).toHaveBeenCalledWith("event-a", expect.objectContaining({ organizationPath: "Organization/org-a" }));
  });
  it("P0 HIGH: rejects organizationPath attribution to a foreign organization instead of persisting the client value", async () => {
    const response = await updateEvent(
      json({ ...validEvent, organizationPath: "Organization/org-b" }),
      context(),
    );
    expect(response.status).toBe(403);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });
  it("P0 BLOCKER: rejects a foreign form pointer and performs no event write", async () => {
    const response = await updateEvent(
      json({ ...validEvent, formPath: "Form/org-b-form" }),
      context(),
    );
    expect(response.status).toBe(403);
    expect(mocks.getEvent).toHaveBeenCalledWith("event-a", "org-a");
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });
  it("rejects changing the server-owned eventPagePath and performs no event write", async () => {
    const response = await updateEvent(
      json({ ...validEvent, eventPagePath: "EventPage/foreign-page" }),
      context(),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Server-owned event pointers cannot be changed",
    });
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });
  it("rejects changing the server-owned invoicePath and performs no event write", async () => {
    const response = await updateEvent(
      json({ ...validEvent, invoicePath: "Invoice/foreign-invoice" }),
      context(),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Server-owned event pointers cannot be changed",
    });
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });
});

describe("M8-T4 page assets POST", () => {
  it("requires authentication", async () => {
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    expect((await uploadAsset(multipart(new File(["x"], "x.png")), context())).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects missing permission, foreign event, missing file, and empty file before storage", async () => {
    signIn([]); expect((await uploadAsset(multipart(new File(["x"], "x.png", { type: "image/png" })), context())).status).toBe(403);
    signIn(["write:events"]); mocks.getEvent.mockResolvedValueOnce(null);
    expect((await uploadAsset(multipart(new File(["x"], "x.png")), context("event-b"))).status).toBe(404);
    expect((await uploadAsset(multipart(), context())).status).toBe(400);
    expect((await uploadAsset(multipart(new File([], "empty.png", { type: "image/png" })), context())).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("derives the storage prefix from authenticated org/event and sanitizes the name", async () => {
    const response = await uploadAsset(multipart(new File(["asset"], "../hero image.svg", { type: "image/svg+xml" })), context());
    expect(response.status).toBe(200);
    const path = (mocks.file.mock.calls as unknown as Array<[string]>)[0][0];
    expect(path).toMatch(/^organizations\/org-a\/events\/event-a\/event-pages\/assets\//);
    expect(path).not.toContain("../");
    expect(mocks.save).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ contentType: "image/svg+xml" }));
  });
});

describe.each([
  ["organization logo", uploadLogo, "write:organization", "organizations/org-a/logo.png", mocks.updateOrg],
  ["profile avatar", uploadAvatar, null, "users/uid-a/avatar.png", mocks.updateUser],
] as const)("M8-T4 %s POST", (_label, handler, permission, expectedPath, dalWrite) => {
  it("requires authentication", async () => {
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    expect((await handler(multipart(new File(["x"], "x.png", { type: "image/png" })))).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(dalWrite).not.toHaveBeenCalled();
  });
  if (permission) {
    it("requires exact write:organization permission", async () => {
      signIn(["write:events"]);
      expect((await handler(multipart(new File(["x"], "x.png", { type: "image/png" })))).status).toBe(403);
      expect(mocks.save).not.toHaveBeenCalled();
      expect(dalWrite).not.toHaveBeenCalled();
    });
  }
  it("rejects missing, empty, oversized, and non-image files without storage/DAL writes", async () => {
    if (permission) signIn([permission]);
    for (const req of [multipart(), multipart(new File([], "x.png", { type: "image/png" })), multipart(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })), multipart(new File(["text"], "x.txt", { type: "text/plain" }))]) {
      expect((await handler(req)).status).toBe(400);
    }
    expect(mocks.save).not.toHaveBeenCalled(); expect(dalWrite).not.toHaveBeenCalled();
  });
  it("writes only the server-derived identity prefix and record", async () => {
    if (permission) signIn([permission]);
    const response = await handler(multipart(new File(["png"], "x.png", { type: "image/png" }), ["organizationId", "org-b"]));
    expect(response.status).toBe(200);
    expect(mocks.file).toHaveBeenCalledWith(expectedPath);
    if (permission) expect(dalWrite).toHaveBeenCalledWith("org-a", expect.objectContaining({ logoUrl: expect.stringContaining(encodeURIComponent(expectedPath)) }));
    else expect(dalWrite).toHaveBeenCalledWith("owner@example.com", expect.objectContaining({ avatarUrl: expect.stringContaining(encodeURIComponent(expectedPath)) }));
  });
});
