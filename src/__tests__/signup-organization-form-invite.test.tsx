/**
 * QA regression (M8-T1 QA pass) — OrganizationForm's invite-token branch
 * (spec §4, D7/D9: "an invite-token signup never picks/creates an org
 * here — the invitation already assigns org + role").
 *
 * This behavior had ZERO test coverage in the shipped M8-T1 diff: the only
 * assertion of "does the new-user signup path skip org-creation" existed as
 * a source-read/structural claim in the review docs, never locked by a
 * test. This file closes that gap: it proves that when
 * `store.prefilledInviteToken` is set, submitting the form (a) never calls
 * `signupCreateOrgAndUser` (the org-CREATE path) or `joinOrganization` (the
 * shared-secret join path) — i.e. it genuinely does not create a
 * duplicate/wrong org — and (b) only creates the Firebase Auth account and
 * hands off to `/invite/{token}` to complete acceptance. Also locks the
 * ordinary (non-invite) path still calls `signupCreateOrgAndUser` as before,
 * so the branch is a genuine fork, not an accidental no-op for everyone.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

const createUserWithEmailAndPassword = vi.fn();
const updateProfile = vi.fn().mockResolvedValue(undefined);
const sendEmailVerification = vi.fn().mockResolvedValue(undefined);
vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: (...args: unknown[]) =>
    createUserWithEmailAndPassword(...args),
  updateProfile: (...args: unknown[]) => updateProfile(...args),
  sendEmailVerification: (...args: unknown[]) => sendEmailVerification(...args),
}));

// Mutable so individual tests can simulate an already-authenticated
// (e.g. Google sign-in already ran upstream) `auth.currentUser` without
// needing a second `vi.mock` registration (module mocks are resolved once).
// vi.hoisted because vi.mock factories are hoisted above plain `const`s.
const authState = vi.hoisted(() => ({ currentUser: null as unknown }));
vi.mock("@/lib/firebase", () => ({
  auth: authState,
}));

const signupCreateOrgAndUser = vi.fn().mockResolvedValue(undefined);
const getOrganizationByDomain = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/db", () => ({
  signupCreateOrgAndUser: (...args: unknown[]) =>
    signupCreateOrgAndUser(...args),
  getOrganizationByDomain: (...args: unknown[]) =>
    getOrganizationByDomain(...args),
}));

const joinOrganization = vi.fn().mockResolvedValue(undefined);
const lookupOrganizationByInviteCode = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/org-join-client", () => ({
  joinOrganization: (...args: unknown[]) => joinOrganization(...args),
  lookupOrganizationByInviteCode: (...args: unknown[]) =>
    lookupOrganizationByInviteCode(...args),
}));

import { useSignupStore } from "@/features/signup/store";
import { OrganizationForm } from "@/features/signup/components/organization-form";

function fakeFirebaseUser(email: string) {
  return {
    uid: `uid-${email}`,
    email,
    displayName: null,
    getIdToken: vi.fn().mockResolvedValue("id-token"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSignupStore.getState().reset();
  authState.currentUser = null;
  createUserWithEmailAndPassword.mockResolvedValue({
    user: fakeFirebaseUser("invitee@example.com"),
  });
});

describe("OrganizationForm — invite-token branch (spec §4, D7/D9)", () => {
  it("renders the 'You're invited' continue-only view, not the org create/join form, when prefilledInviteToken is set", () => {
    useSignupStore.setState({
      email: "invitee@example.com",
      authMethod: "email",
      password: "correct horse battery staple",
      prefilledInviteToken: "tok-abc123",
    });

    render(<OrganizationForm />);

    expect(screen.getByText("You're invited")).toBeTruthy();
    expect(screen.queryByText("Set up your organization")).toBeNull();
  });

  it("creates the Firebase Auth account and redirects to /invite/{token} WITHOUT calling signupCreateOrgAndUser or joinOrganization (no duplicate/wrong org is created)", async () => {
    useSignupStore.setState({
      email: "invitee@example.com",
      authMethod: "email",
      password: "correct horse battery staple",
      name: "Invitee Person",
      prefilledInviteToken: "tok-abc123",
    });

    render(<OrganizationForm />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith("/invite/tok-abc123"),
    );

    // The Firebase Auth account IS created (signup still needs an account)...
    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      "invitee@example.com",
      "correct horse battery staple",
    );
    // ...but org creation/selection is genuinely skipped — the invitation
    // is the sole source of org+role assignment (D7/D9), never a second,
    // parallel org-creation path.
    expect(signupCreateOrgAndUser).not.toHaveBeenCalled();
    expect(joinOrganization).not.toHaveBeenCalled();
  });

  it("an existing (already-authenticated) Google-signup user also skips org creation on the invite path", async () => {
    authState.currentUser = fakeFirebaseUser("googleuser@example.com");

    useSignupStore.setState({
      email: "googleuser@example.com",
      authMethod: "google",
      prefilledInviteToken: "tok-google",
    });

    render(<OrganizationForm />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith("/invite/tok-google"),
    );
    // Google sign-in already created the Firebase user upstream — this step
    // must not attempt a SECOND (email/password) account creation.
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(signupCreateOrgAndUser).not.toHaveBeenCalled();
    expect(joinOrganization).not.toHaveBeenCalled();
  });

  it("control: WITHOUT an invite token, the ordinary org-create path still calls signupCreateOrgAndUser (the branch is a genuine fork, not an accidental no-op for everyone)", async () => {
    useSignupStore.setState({
      email: "founder@example.com",
      authMethod: "email",
      password: "correct horse battery staple",
      name: "Founder Person",
      prefilledInviteToken: undefined,
    });

    render(<OrganizationForm />);

    expect(screen.getByText("Set up your organization")).toBeTruthy();

    fireEvent.change(
      screen.getByPlaceholderText(/acme/i) ??
        screen.getByLabelText(/organization name/i),
      { target: { value: "Founder Co" } },
    );

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(signupCreateOrgAndUser).toHaveBeenCalled());
    expect(joinOrganization).not.toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/signup/complete");
  });
});
