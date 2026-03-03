import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    query,
    where,
    getDocs,
    onSnapshot,
    serverTimestamp,
    increment,
    Timestamp,
    type Unsubscribe,
} from "firebase/firestore";
export { serverTimestamp } from "firebase/firestore";

import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import type { OrganizationDoc, OrganizationMembership, UserDoc, WithId } from "@/types/collection";
import { MEMBER_PERMISSIONS, OWNER_PERMISSIONS } from "@/types/collection";
import { generateSlug } from "@/lib/org-utils";
import { generateInviteCode, generateInviteToken } from "@/lib/invite-utils";

const USERS = "User";
const ORGS  = "Organization";

export async function getOrganizationByDomain(domain: string): Promise<WithId<OrganizationDoc> | null> {
    const q = query(
        collection(db, ORGS),
        where("domain", "==", domain),
        where("allowDomainAutoJoin", "==", true)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...(snap.docs[0].data() as OrganizationDoc) };
}

export async function getOrganizationByInviteCode(normalizedCode: string): Promise<WithId<OrganizationDoc> | null> {
    const q = query(
        collection(db, ORGS),
        where("inviteCode", "==", normalizedCode),
        where("inviteCodeEnabled", "==", true)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...(snap.docs[0].data() as OrganizationDoc) };
}

export async function getOrganization(orgId: string): Promise<OrganizationDoc | null> {
    const snap = await getDoc(doc(db, ORGS, orgId));
    return snap.exists() ? (snap.data() as OrganizationDoc) : null;
}

export async function createOrganization(data: OrganizationDoc): Promise<string> {
    const ref = doc(collection(db, ORGS));
    await setDoc(ref, data);
    return ref.id;
}

export async function getUser(email: string): Promise<UserDoc | null> {
    const snap = await getDoc(doc(db, USERS, email.toLowerCase()));
    return snap.exists() ? (snap.data() as UserDoc) : null;
}

export async function createUser(email: string, data: UserDoc): Promise<void> {
    await setDoc(doc(db, USERS, email.toLowerCase()), data);
}

export async function updateUser(email: string, data: Partial<UserDoc>): Promise<void> {
    await updateDoc(doc(db, USERS, email.toLowerCase()), {
        ...data,
        updatedAt: serverTimestamp(),
    });
}

export async function updateOrganizationMemberCount(orgId: string, delta: number): Promise<void> {
    await updateDoc(doc(db, ORGS, orgId), {
        memberCount: increment(delta),
        updatedAt: serverTimestamp(),
    });
}

export function subscribeToUser(email: string, callback: (data: UserDoc | null) => void): Unsubscribe {
    return onSnapshot(doc(db, USERS, email.toLowerCase()), (snap) => {
        callback(snap.exists() ? (snap.data() as UserDoc) : null);
    });
}

export function subscribeToOrganization(orgId: string, callback: (data: OrganizationDoc | null) => void): Unsubscribe {
    return onSnapshot(doc(db, ORGS, orgId), (snap) => {
        callback(snap.exists() ? (snap.data() as OrganizationDoc) : null);
    });
}

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
