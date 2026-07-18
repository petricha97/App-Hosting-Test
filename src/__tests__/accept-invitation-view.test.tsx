/**
 * M8-T1 — /invite/[token] (spec §4). AcceptInvitationView owns the entire
 * client state machine: loading / not-signed-in / accepting / success /
 * EMAIL_MISMATCH / invalid-or-expired-or-already-accepted. Mocks useAuth
 * (the visitor's live Firebase auth state), the accept API call (fetch),
 * and LoginForm (a pre-existing, already-tested-elsewhere component reused
 * as-is per the ticket's "reuse it, don't reinvent it" instruction).
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args) },
}));

const signOut = vi.fn().mockResolvedValue(undefined);
const useAuthMock = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/components/auth/login-form", () => ({
  LoginForm: ({ redirectTo }: { redirectTo?: string }) => (
    <div data-testid="login-form" data-redirect-to={redirectTo}>
      Login form
    </div>
  ),
}));

import { AcceptInvitationView } from "@/features/iam/components/accept-invitation-view";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function makeUser(email: string, uid = "uid-default") {
  return {
    uid,
    email,
    displayName: "Test User",
    getIdToken: vi.fn().mockResolvedValue("id-token-abc"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  signOut.mockResolvedValue(undefined);
});

describe("AcceptInvitationView — loading state", () => {
  it("shows a loading state while auth is still resolving, without calling the accept API", () => {
    useAuthMock.mockReturnValue({ user: null, initializing: true, signOut });
    vi.stubGlobal("fetch", vi.fn());

    render(<AcceptInvitationView token="tok-1" />);

    expect(screen.getByText("Checking your account...")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("AcceptInvitationView — not signed in", () => {
  it("offers sign-in (reusing LoginForm) and a link to signup carrying the invite token forward", () => {
    useAuthMock.mockReturnValue({ user: null, initializing: false, signOut });
    vi.stubGlobal("fetch", vi.fn());

    render(<AcceptInvitationView token="tok-1" />);

    const loginForm = screen.getByTestId("login-form");
    expect(loginForm.getAttribute("data-redirect-to")).toBe("/invite/tok-1");

    const signupLink = screen.getByRole("link", { name: "Create an account" });
    expect(signupLink.getAttribute("href")).toBe("/signup?inviteToken=tok-1");

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("AcceptInvitationView — signed in, accept succeeds", () => {
  it("calls the accept API with a Bearer token, shows success, and redirects to the dashboard", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = makeUser("alice@example.com");
    useAuthMock.mockReturnValue({ user, initializing: false, signOut });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ organizationId: "org-1", role: "editor" }),
        ),
    );

    render(<AcceptInvitationView token="tok-1" />);

    await waitFor(() => expect(screen.getByText("You're in!")).toBeTruthy());

    expect(fetch).toHaveBeenCalledWith(
      "/api/organizations/invitations/accept",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer id-token-abc",
        }),
      }),
    );
    // Also syncs the session cookie so the redirect into /dashboard works.
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({ method: "POST" }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("You've joined the workspace.");

    await vi.advanceTimersByTimeAsync(1500);
    expect(routerPush).toHaveBeenCalledWith("/dashboard");
    vi.useRealTimers();
  });
});

describe("AcceptInvitationView — signed in, EMAIL_MISMATCH (spec §4 AC-2)", () => {
  it("shows a specific wrong-account error, never implying a retry will help", async () => {
    const user = makeUser("bob@example.com");
    useAuthMock.mockReturnValue({ user, initializing: false, signOut });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: "This invitation is not addressed to your account." },
            403,
          ),
        ),
    );

    render(<AcceptInvitationView token="tok-1" />);

    expect(await screen.findByText("Wrong account")).toBeTruthy();
    expect(screen.getByText(/sent to a different email address/i)).toBeTruthy();

    const retryButton = screen.getByRole("button", {
      name: "Sign out & try again",
    });
    retryButton.click();
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/login"));
  });
});

describe("AcceptInvitationView — invalid/expired/already-accepted (INVALID, spec §4)", () => {
  it("shows a clear 'no longer valid' message with a link back to sign in, using the server's own copy", async () => {
    const user = makeUser("alice@example.com");
    useAuthMock.mockReturnValue({ user, initializing: false, signOut });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: "This invitation is no longer valid." }, 410),
        ),
    );

    render(<AcceptInvitationView token="expired-tok" />);

    expect(
      await screen.findByText("This invitation is no longer valid"),
    ).toBeTruthy();
    expect(
      screen.getAllByText("This invitation is no longer valid.").length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /back to home/i })).toBeTruthy();
  });

  it("links to the dashboard (not sign-in) when the invalid result occurs for an already-authenticated caller", async () => {
    const user = makeUser("alice@example.com");
    useAuthMock.mockReturnValue({ user, initializing: false, signOut });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: "This workspace no longer exists." }, 404),
        ),
    );

    render(<AcceptInvitationView token="tok-1" />);

    expect(
      await screen.findByText("This invitation is no longer valid"),
    ).toBeTruthy();
    const dashboardLink = screen.getByRole("link", {
      name: "Go to your dashboard",
    });
    expect(dashboardLink.getAttribute("href")).toBe("/dashboard");
  });

  it("shows a generic error state when the accept call itself throws (network failure)", async () => {
    const user = makeUser("alice@example.com");
    useAuthMock.mockReturnValue({ user, initializing: false, signOut });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    render(<AcceptInvitationView token="tok-1" />);

    expect(
      await screen.findByText("This invitation is no longer valid"),
    ).toBeTruthy();
    expect(
      screen.getByText(/something went wrong while accepting/i),
    ).toBeTruthy();
  });
});

describe("AcceptInvitationView — retry after switching identity", () => {
  it("re-attempts the accept call when a DIFFERENT signed-in user (different uid) is now active", async () => {
    const bob = makeUser("bob@example.com", "uid-bob");
    useAuthMock.mockReturnValue({ user: bob, initializing: false, signOut });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "This invitation is not addressed to your account." },
          403,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const acceptCallCount = () =>
      fetchMock.mock.calls.filter(
        ([url]) => url === "/api/organizations/invitations/accept",
      ).length;

    const { rerender } = render(<AcceptInvitationView token="tok-1" />);
    expect(await screen.findByText("Wrong account")).toBeTruthy();
    expect(acceptCallCount()).toBe(1);

    // A different account (different uid) signs in — the guard must not
    // suppress a fresh accept attempt for this new identity.
    const alice = makeUser("alice@example.com", "uid-alice");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ organizationId: "org-1", role: "viewer" }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true })); // session sync
    useAuthMock.mockReturnValue({ user: alice, initializing: false, signOut });
    rerender(<AcceptInvitationView token="tok-1" />);

    await waitFor(() => expect(acceptCallCount()).toBe(2));
    expect(await screen.findByText("You're in!")).toBeTruthy();
  });
});
