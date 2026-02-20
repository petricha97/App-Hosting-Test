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
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
    updateProfile,
    sendEmailVerification,
    type User,
} from "firebase/auth";
import {
    doc,
    getDoc,
    onSnapshot,
    serverTimestamp,
    setDoc,
    updateDoc,
    collection,
    query,
    where,
    getDocs,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { OrganizationDoc, UserDoc, OrganizationMembership } from "@/types/collection";
import { OWNER_PERMISSIONS } from "@/types/collection";
import { extractDomain, suggestOrganizationType } from "@/lib/domain-utils";
import { generateSlug } from "@/lib/org-utils";
import { generateInviteCode, generateInviteToken } from "@/lib/invite-utils";

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
    signUp: (data: SignUpData) => Promise<SignUpResult>;
    signInWithGoogle: () => Promise<GoogleSignInResult>;
    signOut: () => Promise<void>;
    switchOrganization: (orgId: string) => Promise<void>;
    refreshUserData: () => Promise<void>;
}

export interface SignUpData {
    email: string;
    password: string;
    name?: string;
    organizationName: string;
    organizationType?: "organization" | "workspace";
}

export interface SignUpResult {
    user: User;
    organizationId: string;
    requiresDomainVerification: boolean;
    domain?: string;
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
                const userRef = doc(db, "User", userEmail);
                const userSnap = await getDoc(userRef);

                if (userSnap.exists()) {
                    const userData = userSnap.data() as UserDoc;
                    setUserDoc(userData);

                    if (userData.organizationId) {
                        const orgRef = doc(db, "Organization", userData.organizationId);
                        const orgSnap = await getDoc(orgRef);
                        if (orgSnap.exists()) {
                            setOrganization(orgSnap.data() as OrganizationDoc);
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
        const unsubscribe = onSnapshot(doc(db, "User", userEmail), (snap) => {
            if (snap.exists()) {
                setUserDoc(snap.data() as UserDoc);
            }
        });

        return () => unsubscribe();
    }, [user]);

    // Real-time listener for organization document changes
    useEffect(() => {
        if (!organizationId) return;

        const unsubscribe = onSnapshot(doc(db, "Organization", organizationId), (snap) => {
            if (snap.exists()) {
                setOrganization(snap.data() as OrganizationDoc);
            }
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

    const signUp = useCallback(async (data: SignUpData): Promise<SignUpResult> => {
        setLoading(true);
        try {
            const { email, password, name, organizationName, organizationType } = data;

            const cred = await createUserWithEmailAndPassword(auth, email, password);
            const firebaseUser = cred.user;

            if (name) {
                await updateProfile(firebaseUser, { displayName: name });
            }

            await sendEmailVerification(firebaseUser);

            const domain = extractDomain(email);
            const finalOrgType = organizationType || suggestOrganizationType(email);
            const requiresDomainVerification = finalOrgType === "organization" && domain !== null;

            const orgRef = doc(collection(db, "Organization"));
            const orgData: OrganizationDoc = {
                name: organizationName,
                description: "",
                slug: generateSlug(organizationName),
                type: finalOrgType,
                status: "pending",
                domain: finalOrgType === "organization" ? domain || undefined : undefined,
                domainVerified: false,
                domainVerifiedAt: undefined,
                inviteCode: generateInviteCode(),
                inviteCodeEnabled: true,
                inviteLinkToken: generateInviteToken(),
                inviteLinkEnabled: true,
                allowDomainAutoJoin: finalOrgType === "organization",
                ownerId: email.toLowerCase(),
                memberCount: 1,
                createdAt: serverTimestamp() as any,
                updatedAt: serverTimestamp() as any,
            };
            await setDoc(orgRef, orgData);

            const membership: OrganizationMembership = {
                organizationId: orgRef.id,
                role: "owner",
                joinedAt: serverTimestamp() as any,
                joinMethod: "created",
            };

            const userEmail = email.toLowerCase();
            const userData: UserDoc = {
                uid: firebaseUser.uid,
                name: name || "",
                email: userEmail,
                avatarUrl: firebaseUser.photoURL || undefined,
                organizationId: orgRef.id,
                organizationRole: "owner",
                organizations: [membership],
                emailVerified: false,
                status: "active",
                permissions: OWNER_PERMISSIONS,
                createdAt: serverTimestamp() as any,
                updatedAt: serverTimestamp() as any,
            };
            await setDoc(doc(db, "User", userEmail), userData);

            return {
                user: firebaseUser,
                organizationId: orgRef.id,
                requiresDomainVerification,
                domain: domain || undefined,
            };
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
            const userRef = doc(db, "User", userEmail);
            const userSnap = await getDoc(userRef);
            const isNewUser = !userSnap.exists();

            let existingOrgForDomain: OrganizationDoc | null = null;
            let existingOrgId: string | null = null;

            if (domain && suggestedOrgType === "organization") {
                const orgQuery = query(
                    collection(db, "Organization"),
                    where("domain", "==", domain),
                    where("allowDomainAutoJoin", "==", true)
                );
                const orgSnap = await getDocs(orgQuery);
                if (!orgSnap.empty) {
                    existingOrgForDomain = orgSnap.docs[0].data() as OrganizationDoc;
                    existingOrgId = orgSnap.docs[0].id;
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
        await updateDoc(doc(db, "User", userEmail), {
            organizationId: orgId,
            organizationRole: membership.role,
            updatedAt: serverTimestamp(),
        });

        const orgRef = doc(db, "Organization", orgId);
        const orgSnap = await getDoc(orgRef);
        if (orgSnap.exists()) {
            setOrganization(orgSnap.data() as OrganizationDoc);
            setOrganizationId(orgId);
        }
    }, [user, userDoc]);

    const refreshUserData = useCallback(async () => {
        if (!user || !user.email) return;

        const userEmail = user.email.toLowerCase();
        const userRef = doc(db, "User", userEmail);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const userData = userSnap.data() as UserDoc;
            setUserDoc(userData);

            if (userData.organizationId) {
                const orgRef = doc(db, "Organization", userData.organizationId);
                const orgSnap = await getDoc(orgRef);
                if (orgSnap.exists()) {
                    setOrganization(orgSnap.data() as OrganizationDoc);
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
        signUp,
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
