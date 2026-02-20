"use client";

import * as React from "react";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
    createUserWithEmailAndPassword,
    updateProfile,
    sendEmailVerification,
    GoogleAuthProvider,
    signInWithPopup,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { doc, setDoc, serverTimestamp, collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import { CredentialsStep, type CredentialsData } from "./steps/credentials-step";
import { OrganizationStep, type OrganizationData } from "./steps/organization-step";
import { VerificationStep, type VerificationData } from "./steps/verification-step";
import { CompleteStep } from "./steps/complete-step";

import { extractDomain, suggestOrganizationType, isPersonalEmail } from "@/lib/domain-utils";
import { generateSlug } from "@/lib/org-utils";
import { generateInviteCode, generateInviteToken } from "@/lib/invite-utils";
import type { OrganizationDoc, UserDoc, OrganizationMembership } from "@/types/collection";
import { OWNER_PERMISSIONS, MEMBER_PERMISSIONS } from "@/types/collection";

export interface SignupWizardProps extends React.ComponentProps<"div"> {
    redirectTo?: string;
    inviteCode?: string;
    inviteToken?: string;
}

type Step = 1 | 2 | 3 | 4;

interface WizardState {
    credentials: CredentialsData | null;
    authMethod: "email" | "google";
    emailDomain: string | null;
    isPersonalEmail: boolean;
    existingOrgForDomain: { org: OrganizationDoc; id: string } | null;
    organization: OrganizationData | null;
    verification: VerificationData | null;
    organizationId: string | null;
    requiresDomainVerification: boolean;
}

const initialState: WizardState = {
    credentials: null,
    authMethod: "email",
    emailDomain: null,
    isPersonalEmail: true,
    existingOrgForDomain: null,
    organization: null,
    verification: null,
    organizationId: null,
    requiresDomainVerification: false,
};

export function SignupWizard({
    className,
    redirectTo = "/dashboard",
    inviteCode,
    inviteToken,
    ...props
}: SignupWizardProps) {
    const router = useRouter();
    const [step, setStep] = useState<Step>(1);
    const [state, setState] = useState<WizardState>(initialState);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const totalSteps = 4;
    const progress = (step / totalSteps) * 100;

    const checkExistingOrg = useCallback(async (domain: string) => {
        if (!domain || isPersonalEmail(`user@${domain}`)) {
            setState(prev => ({ ...prev, existingOrgForDomain: null }));
            return;
        }
        try {
            const orgQuery = query(
                collection(db, "Organization"),
                where("domain", "==", domain)
            );
            const orgSnap = await getDocs(orgQuery);
            const match = orgSnap.docs.find(d => d.data().allowDomainAutoJoin === true);
            if (match) {
                setState(prev => ({
                    ...prev,
                    existingOrgForDomain: {
                        org: match.data() as OrganizationDoc,
                        id: match.id,
                    },
                }));
            } else {
                setState(prev => ({ ...prev, existingOrgForDomain: null }));
            }
        } catch (err) {
            console.error("Error checking existing org:", err);
        }
    }, []);

    const handleCredentialsComplete = useCallback(async (data: CredentialsData) => {
        const domain = extractDomain(data.email);
        const personal = isPersonalEmail(data.email);

        setState(prev => ({
            ...prev,
            credentials: data,
            authMethod: "email",
            emailDomain: domain,
            isPersonalEmail: personal,
        }));

        if (domain && !personal) {
            await checkExistingOrg(domain);
        }

        setStep(2);
    }, [checkExistingOrg]);

    const handleGoogleSignIn = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            const email = user.email || "";
            const domain = extractDomain(email);
            const personal = isPersonalEmail(email);

            setState(prev => ({
                ...prev,
                credentials: {
                    name: user.displayName || "",
                    email,
                    password: "",
                    confirmPassword: "",
                },
                authMethod: "google",
                emailDomain: domain,
                isPersonalEmail: personal,
            }));

            if (domain && !personal) {
                await checkExistingOrg(domain);
            }

            setStep(2);
        } catch (err) {
            setError(err instanceof FirebaseError ? "Google sign in failed. Please try again." : "An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    }, [checkExistingOrg]);

    const completeSignup = useCallback(async (
        orgData: OrganizationData,
        verificationData?: VerificationData
    ) => {
        setLoading(true);
        setError(null);

        try {
            let firebaseUser = auth.currentUser;

            if (state.authMethod === "email" && state.credentials) {
                const cred = await createUserWithEmailAndPassword(
                    auth,
                    state.credentials.email,
                    state.credentials.password
                );
                firebaseUser = cred.user;

                if (state.credentials.name) {
                    await updateProfile(firebaseUser, { displayName: state.credentials.name });
                }

                await sendEmailVerification(firebaseUser);
            }

            if (!firebaseUser || !firebaseUser.email) {
                throw new Error("No authenticated user");
            }

            const userEmail = firebaseUser.email.toLowerCase();
            let organizationId: string;
            let requiresDomainVerification = false;

            if (orgData.action === "join" || orgData.action === "auto-join") {
                organizationId = orgData.existingOrgId!;

                const membership: OrganizationMembership = {
                    organizationId,
                    role: "member",
                    joinedAt: Timestamp.now(),
                    joinMethod: orgData.action === "auto-join" ? "domain_auto_join" : "invite_code",
                };

                const userData: UserDoc = {
                    uid: firebaseUser.uid,
                    name: state.credentials?.name || firebaseUser.displayName || "",
                    email: userEmail,
                    organizationId,
                    organizationRole: "member",
                    organizations: [membership],
                    emailVerified: false,
                    status: "active",
                    permissions: MEMBER_PERMISSIONS,
                    createdAt: serverTimestamp() as any,
                    updatedAt: serverTimestamp() as any,
                    ...(firebaseUser.photoURL ? { avatarUrl: firebaseUser.photoURL } : {}),
                };

                await setDoc(doc(db, "User", userEmail), userData);
            } else {
                const orgType = orgData.organizationType || suggestOrganizationType(firebaseUser.email || "");
                requiresDomainVerification = orgType === "organization" && !state.isPersonalEmail;

                const orgRef = doc(collection(db, "Organization"));
                organizationId = orgRef.id;

                const newOrg: OrganizationDoc = {
                    name: orgData.organizationName!,
                    description: "",
                    slug: generateSlug(orgData.organizationName!),
                    type: orgType,
                    status: "pending",
                    domainVerified: false,
                    inviteCode: generateInviteCode(),
                    inviteCodeEnabled: true,
                    inviteLinkToken: generateInviteToken(),
                    inviteLinkEnabled: true,
                    allowDomainAutoJoin: orgType === "organization",
                    ownerId: userEmail,
                    memberCount: 1,
                    createdAt: serverTimestamp() as any,
                    updatedAt: serverTimestamp() as any,
                    ...(orgType === "organization" && state.emailDomain ? { domain: state.emailDomain } : {}),
                };

                await setDoc(orgRef, newOrg);

                const membership: OrganizationMembership = {
                    organizationId,
                    role: "owner",
                    joinedAt: Timestamp.now(),
                    joinMethod: "created",
                };

                const userData: UserDoc = {
                    uid: firebaseUser.uid,
                    name: state.credentials?.name || firebaseUser.displayName || "",
                    email: userEmail,
                    organizationId,
                    organizationRole: "owner",
                    organizations: [membership],
                    emailVerified: false,
                    status: "active",
                    permissions: OWNER_PERMISSIONS,
                    createdAt: serverTimestamp() as any,
                    updatedAt: serverTimestamp() as any,
                    ...(firebaseUser.photoURL ? { avatarUrl: firebaseUser.photoURL } : {}),
                };

                await setDoc(doc(db, "User", userEmail), userData);
            }

            setState(prev => ({ ...prev, organizationId, requiresDomainVerification }));
            setStep(4);
        } catch (err) {
            if (err instanceof FirebaseError) {
                switch (err.code) {
                    case "auth/email-already-in-use":
                        setError("This email is already in use. Please log in instead.");
                        break;
                    case "auth/weak-password":
                        setError("Password is too weak. Please use a stronger password.");
                        break;
                    default:
                        setError(`Could not complete signup: ${err.code}`);
                }
            } else {
                setError("An unexpected error occurred. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    }, [state]);

    const handleOrganizationComplete = useCallback(async (data: OrganizationData) => {
        setState(prev => ({ ...prev, organization: data }));

        if (data.action === "join" || data.action === "auto-join") {
            await completeSignup(data);
        } else if (state.isPersonalEmail) {
            setState(prev => ({ ...prev, verification: { skipVerification: true } }));
            await completeSignup(data);
        } else {
            setStep(3);
        }
    }, [state.isPersonalEmail, completeSignup]);

    const handleVerificationComplete = useCallback(async (data: VerificationData) => {
        setState(prev => ({ ...prev, verification: data }));
        await completeSignup(state.organization!, data);
    }, [state.organization, completeSignup]);

    const handleBack = useCallback(() => {
        if (step > 1) setStep(prev => (prev - 1) as Step);
    }, [step]);

    const handleComplete = useCallback(() => {
        router.push(redirectTo);
    }, [router, redirectTo]);

    const stepTitles = [
        "Create your account",
        "Set up your organization",
        "Verify your domain",
        "Welcome!",
    ];

    const stepDescriptions = [
        "Enter your credentials to get started.",
        "Choose how you want to organize your team.",
        "Verify ownership of your domain.",
        "You're all set to start using the platform.",
    ];

    return (
        <div className={cn("w-full max-w-md mx-auto", className)} {...props}>
            <Card>
                <CardHeader>
                    <div className="mb-4">
                        <Progress value={progress} className="h-2" />
                        <p className="text-xs text-muted-foreground mt-2">
                            Step {step} of {totalSteps}
                        </p>
                    </div>
                    <CardTitle>{stepTitles[step - 1]}</CardTitle>
                    <CardDescription>{stepDescriptions[step - 1]}</CardDescription>
                </CardHeader>
                <CardContent>
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-md">
                            {error}
                        </div>
                    )}

                    {step === 1 && (
                        <CredentialsStep
                            onComplete={handleCredentialsComplete}
                            onGoogleSignIn={handleGoogleSignIn}
                            loading={loading}
                            inviteCode={inviteCode}
                        />
                    )}

                    {step === 2 && (
                        <OrganizationStep
                            onComplete={handleOrganizationComplete}
                            onBack={handleBack}
                            loading={loading}
                            email={state.credentials?.email || ""}
                            emailDomain={state.emailDomain}
                            isPersonalEmail={state.isPersonalEmail}
                            existingOrgForDomain={state.existingOrgForDomain}
                            inviteCode={inviteCode}
                        />
                    )}

                    {step === 3 && (
                        <VerificationStep
                            onComplete={handleVerificationComplete}
                            onBack={handleBack}
                            onSkip={() => {
                                setState(prev => ({ ...prev, verification: { skipVerification: true } }));
                                completeSignup(state.organization!);
                            }}
                            loading={loading}
                            email={state.credentials?.email || ""}
                            organizationName={state.organization?.organizationName || ""}
                        />
                    )}

                    {step === 4 && (
                        <CompleteStep
                            onComplete={handleComplete}
                            organizationName={state.organization?.organizationName || ""}
                            organizationType={state.organization?.organizationType || "workspace"}
                            requiresDomainVerification={state.requiresDomainVerification}
                            isJoining={state.organization?.action === "join" || state.organization?.action === "auto-join"}
                        />
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
