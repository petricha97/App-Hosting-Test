import { create } from "zustand";

type SignupStore = {
    // Accumulated across steps
    name?: string;
    email?: string;
    password?: string;
    authMethod: "email" | "google";
    action?: "create" | "join" | "auto-join";
    organizationName?: string;
    inviteCode?: string;
    existingOrgId?: string;
    // Passed in from URL params
    prefilledCode?: string;
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
        }),
}));
