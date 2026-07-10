import {
    doc,
    setDoc,
    collection,
    serverTimestamp,
    Timestamp,
} from "firebase/firestore";
export { serverTimestamp } from "firebase/firestore";

import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import type { OrganizationDoc, OrganizationMembership, UserDoc } from "@/types/collection";
import { OWNER_PERMISSIONS } from "@/types/collection";
import { generateSlug } from "@/lib/org-utils";
import { generateInviteCode, generateInviteToken } from "@/lib/invite-utils";

const ORGS = "Organization";
const USERS = "User";


// ============================================================================
// Signup flows
// ============================================================================
//
// NOTE (SEC M2 Findings 1-3): the JOIN flows that used to live here
// (signupJoinOrg / addExistingUserToOrg / createNewUserAndJoinOrg) are
// SERVER-ONLY now — firestore.rules denies client writes to the membership
// roster, the permissions mirror, and Organization.memberCount. Joins go
// through POST /api/organizations/join (src/lib/org-join-client.ts), which
// validates the entitlement and delegates to the atomic
// addAdminUserToOrganization transaction (src/lib/db/adminUserOrganization.ts).
//
// Creating a BRAND-NEW org with the caller as owner stays client-side: the
// rules allow exactly this create shape (owner-of-a-new-org User doc + a
// pending Organization owned by the caller).

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
