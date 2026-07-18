import { create } from "zustand";

type SignupStore = {
  // Accumulated across steps
  name?: string;
  email?: string;
  password?: string;
  authMethod: "email" | "google";
  action?: "create" | "join" | "auto-join" | "invite";
  organizationName?: string;
  inviteCode?: string;
  existingOrgId?: string;
  // Passed in from URL params
  prefilledCode?: string;
  // M8-T1: carries a per-email invitation token (POST /api/organizations/
  // invitations/accept) through the signup wizard, mirroring prefilledCode's
  // shape exactly — set from ?inviteToken= via credentials-form, read by
  // organization-form to skip org creation/selection (the invitation
  // already assigns the org + role) and instead create the Firebase Auth
  // account, then hand off to /invite/{token} to complete acceptance.
  prefilledInviteToken?: string;
  // Mutations
  setData: (data: Partial<Omit<SignupStore, "setData" | "reset">>) => void;
  reset: () => void;
};

export const useSignupStore = create<SignupStore>((set) => ({
  authMethod: "email",
  setData: (data) => set(data),
  reset: () =>
    set({
      authMethod: "email",
      name: undefined,
      email: undefined,
      password: undefined,
      action: undefined,
      organizationName: undefined,
      inviteCode: undefined,
      existingOrgId: undefined,
      prefilledCode: undefined,
      prefilledInviteToken: undefined,
    }),
}));
