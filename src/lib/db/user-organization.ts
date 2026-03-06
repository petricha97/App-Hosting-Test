import {
    doc,
    setDoc,
    updateDoc,
    collection,
    serverTimestamp,
    increment,
    Timestamp,
} from "firebase/firestore";
export { serverTimestamp } from "firebase/firestore";

import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import type { OrganizationDoc, OrganizationMembership, UserDoc, WithId } from "@/types/collection";
import { MEMBER_PERMISSIONS, OWNER_PERMISSIONS } from "@/types/collection";
import { generateSlug } from "@/lib/org-utils";
import { generateInviteCode, generateInviteToken } from "@/lib/invite-utils";

const ORGS = "Organization";
const USERS = "User";


// ============================================================================
// Signup / Join flows
// ============================================================================

/** New user joins an existing org via invite code or domain auto-join. */
export async function signupJoinOrg(
    firebaseUser: User,
    displayName: string,
    orgId: string,
    joinMethod: "invite_code" | "domain_auto_join"
): Promise<void> {
    const userEmail = firebaseUser.email!.toLowerCase();

    const membership: OrganizationMembership = {
        organizationId: orgId,
        role: "member",
        joinedAt: Timestamp.now(),
        joinMethod,
    };

    const userData: UserDoc = {
        uid: firebaseUser.uid,
        name: displayName,
        email: userEmail,
        organizationId: orgId,
        organizationRole: "member",
        organizations: [membership],
        emailVerified: false,
        status: "active",
        permissions: MEMBER_PERMISSIONS,
        createdAt: serverTimestamp() as any,
        updatedAt: serverTimestamp() as any,
        ...(firebaseUser.photoURL ? { avatarUrl: firebaseUser.photoURL } : {}),
    };

    await setDoc(doc(db, USERS, userEmail), userData);
    await updateDoc(doc(db, ORGS, orgId), {
        memberCount: increment(1),
        updatedAt: serverTimestamp(),
    });
}

/** New user creates a brand-new org and becomes its owner. */
export async function signupCreateOrgAndUser(
    firebaseUser: User,
    displayName: string,
    orgName: string,
    emailDomain: string | null,
    isPersonalEmail: boolean
): Promise<{ orgId: string; requiresDomainVerification: boolean }> {
    const userEmail = firebaseUser.email!.toLowerCase();
    const orgType = isPersonalEmail ? "workspace" : "organization";
    const requiresDomainVerification = !isPersonalEmail;

    const orgRef = doc(collection(db, ORGS));
    const orgId = orgRef.id;

    const newOrg: OrganizationDoc = {
        name: orgName,
        description: "",
        slug: generateSlug(orgName),
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
        ...(orgType === "organization" && emailDomain ? { domain: emailDomain } : {}),
    };

    await setDoc(orgRef, newOrg);

    const membership: OrganizationMembership = {
        organizationId: orgId,
        role: "owner",
        joinedAt: Timestamp.now(),
        joinMethod: "created",
    };

    const userData: UserDoc = {
        uid: firebaseUser.uid,
        name: displayName,
        email: userEmail,
        organizationId: orgId,
        organizationRole: "owner",
        organizations: [membership],
        emailVerified: false,
        status: "active",
        permissions: OWNER_PERMISSIONS,
        createdAt: serverTimestamp() as any,
        updatedAt: serverTimestamp() as any,
        ...(firebaseUser.photoURL ? { avatarUrl: firebaseUser.photoURL } : {}),
    };

    await setDoc(doc(db, USERS, userEmail), userData);

    return { orgId, requiresDomainVerification };
}

/** Logged-in user with an existing Firestore doc joins an org via invite code. */
export async function addExistingUserToOrg(
    userEmail: string,
    orgId: string,
    currentOrganizations: OrganizationMembership[]
): Promise<void> {
    const membership: OrganizationMembership = {
        organizationId: orgId,
        role: "member",
        joinedAt: Timestamp.now(),
        joinMethod: "invite_code",
    };

    await updateDoc(doc(db, USERS, userEmail.toLowerCase()), {
        organizationId: orgId,
        organizationRole: "member",
        organizations: [...currentOrganizations, membership],
        updatedAt: serverTimestamp(),
    });

    await updateDoc(doc(db, ORGS, orgId), {
        memberCount: increment(1),
        updatedAt: serverTimestamp(),
    });
}

/** Firebase Auth user with no Firestore doc joins an org via invite code. */
export async function createNewUserAndJoinOrg(
    firebaseUser: User,
    orgId: string
): Promise<void> {
    const userEmail = firebaseUser.email!.toLowerCase();

    const membership: OrganizationMembership = {
        organizationId: orgId,
        role: "member",
        joinedAt: Timestamp.now(),
        joinMethod: "invite_code",
    };

    const userData: UserDoc = {
        uid: firebaseUser.uid,
        name: firebaseUser.displayName || "",
        email: userEmail,
        organizationId: orgId,
        organizationRole: "member",
        organizations: [membership],
        emailVerified: firebaseUser.emailVerified,
        status: "active",
        permissions: MEMBER_PERMISSIONS,
        createdAt: serverTimestamp() as any,
        updatedAt: serverTimestamp() as any,
        ...(firebaseUser.photoURL ? { avatarUrl: firebaseUser.photoURL } : {}),
    };

    await setDoc(doc(db, USERS, userEmail), userData);

    await updateDoc(doc(db, ORGS, orgId), {
        memberCount: increment(1),
        updatedAt: serverTimestamp(),
    });
}


