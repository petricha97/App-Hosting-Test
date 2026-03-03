"use client";

import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    type ReactNode,
} from "react";
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
    type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    getUser,
    getOrganization,
    updateUser,
    getOrganizationByDomain,
    subscribeToUser,
    subscribeToOrganization,
} from "@/lib/db";
import type { OrganizationDoc, UserDoc } from "@/types/collection";
import { extractDomain, suggestOrganizationType } from "@/lib/domain-utils";

// ============================================================================
// Types
// ============================================================================

export interface AuthContextValue {
    user: User | null;
    userDoc: UserDoc | null;
    organization: OrganizationDoc | null;
    organizationId: string | null;
    loading: boolean;
    initializing: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signInWithGoogle: () => Promise<GoogleSignInResult>;
    signOut: () => Promise<void>;
    switchOrganization: (orgId: string) => Promise<void>;
    refreshUserData: () => Promise<void>;
}

export interface GoogleSignInResult {
    user: User;
    isNewUser: boolean;
    email: string;
    domain: string | null;
    suggestedOrgType: "organization" | "workspace";
    existingOrgForDomain: OrganizationDoc | null;
    existingOrgId: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
    const [organization, setOrganization] = useState<OrganizationDoc | null>(null);
    const [organizationId, setOrganizationId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [initializing, setInitializing] = useState(true);

    // Listen to Firebase Auth state changes
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setUser(firebaseUser);

            if (firebaseUser && firebaseUser.email) {
                const userEmail = firebaseUser.email.toLowerCase();
                const userData = await getUser(userEmail);

                if (userData) {
                    setUserDoc(userData);

                    if (userData.organizationId) {
                        const orgData = await getOrganization(userData.organizationId);
                        if (orgData) {
                            setOrganization(orgData);
                            setOrganizationId(userData.organizationId);
                        }
                    }
                } else {
                    setUserDoc(null);
                    setOrganization(null);
                    setOrganizationId(null);
                }
            } else {
                setUserDoc(null);
                setOrganization(null);
                setOrganizationId(null);
            }

            setInitializing(false);
        });

        return () => unsubscribe();
    }, []);

    // Real-time listener for user document changes
    useEffect(() => {
        if (!user || !user.email) return;

        const userEmail = user.email.toLowerCase();
        const unsubscribe = subscribeToUser(userEmail, (data) => {
            if (data) setUserDoc(data);
        });

        return () => unsubscribe();
    }, [user]);

    // Real-time listener for organization document changes
    useEffect(() => {
        if (!organizationId) return;

        const unsubscribe = subscribeToOrganization(organizationId, (data) => {
            if (data) setOrganization(data);
        });

        return () => unsubscribe();
    }, [organizationId]);

    const signIn = useCallback(async (email: string, password: string) => {
        setLoading(true);
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } finally {
            setLoading(false);
        }
    }, []);

    const signInWithGoogle = useCallback(async (): Promise<GoogleSignInResult> => {
        setLoading(true);
        try {
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            const firebaseUser = result.user;
            const email = firebaseUser.email || "";
            const domain = extractDomain(email);
            const suggestedOrgType = suggestOrganizationType(email);

            const userEmail = email.toLowerCase();
            const existingUser = await getUser(userEmail);
            const isNewUser = !existingUser;

            let existingOrgForDomain: OrganizationDoc | null = null;
            let existingOrgId: string | null = null;

            if (domain && suggestedOrgType === "organization") {
                const found = await getOrganizationByDomain(domain);
                if (found) {
                    existingOrgForDomain = found;
                    existingOrgId = found.id;
                }
            }

            return {
                user: firebaseUser,
                isNewUser,
                email,
                domain,
                suggestedOrgType,
                existingOrgForDomain,
                existingOrgId,
            };
        } finally {
            setLoading(false);
        }
    }, []);

    const signOut = useCallback(async () => {
        setLoading(true);
        try {
            await firebaseSignOut(auth);
            setUserDoc(null);
            setOrganization(null);
            setOrganizationId(null);
        } finally {
            setLoading(false);
        }
    }, []);

    const switchOrganization = useCallback(async (orgId: string) => {
        if (!user || !user.email || !userDoc) return;

        const membership = userDoc.organizations.find(m => m.organizationId === orgId);
        if (!membership) {
            throw new Error("You don't have access to this organization");
        }

        const userEmail = user.email.toLowerCase();
        await updateUser(userEmail, {
            organizationId: orgId,
            organizationRole: membership.role,
        });

        const orgData = await getOrganization(orgId);
        if (orgData) {
            setOrganization(orgData);
            setOrganizationId(orgId);
        }
    }, [user, userDoc]);

    const refreshUserData = useCallback(async () => {
        if (!user || !user.email) return;

        const userEmail = user.email.toLowerCase();
        const userData = await getUser(userEmail);
        if (userData) {
            setUserDoc(userData);

            if (userData.organizationId) {
                const orgData = await getOrganization(userData.organizationId);
                if (orgData) {
                    setOrganization(orgData);
                    setOrganizationId(userData.organizationId);
                }
            }
        }
    }, [user]);

    const value: AuthContextValue = {
        user,
        userDoc,
        organization,
        organizationId,
        loading,
        initializing,
        signIn,
        signInWithGoogle,
        signOut,
        switchOrganization,
        refreshUserData,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
