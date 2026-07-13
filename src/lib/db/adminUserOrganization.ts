// Server-side membership mutations for the embedded UserDoc.organizations[]
// roster + Organization.memberCount counter (closes baseline R7 and the
// audit gap "no admin variant of user-organization.ts").
//
// Under the M2 firestore.rules lockdown, clients can no longer write
// permissions / organizations / memberCount, so EVERY membership change
// (signup joins, invite-code joins, domain auto-joins, owner-org creation)
// must go through these Admin-SDK helpers. Each mutation pairs the User
// roster write with the Organization.memberCount increment ATOMICALLY (one
// transaction) — the two-non-atomic-writes flaw of the client
// user-organization.ts flows does not exist here.
//
// Trust contract: userDoc.permissions is stamped HERE (from the role of the
// active org) and is what routes gate on; userDoc.organizationId is only a
// valid tenant key when the roster confirms it (src/lib/org-membership.ts).
import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import { findOrganizationMembership } from "@/lib/org-membership";
import { generateSlug } from "@/lib/org-utils";
import { generateInviteCode, generateInviteToken } from "@/lib/invite-utils";
import {
  MEMBER_PERMISSIONS,
  OWNER_PERMISSIONS,
  type OrganizationDoc,
  type OrganizationMembership,
  type UserDoc,
  type UserPermission,
} from "@/types/collection";

const USER_COLLECTION = "User";
const ORGANIZATION_COLLECTION = "Organization";

function userRef(userEmail: string) {
  return adminDb.collection(USER_COLLECTION).doc(userEmail.toLowerCase());
}

function organizationRef(organizationId: string) {
  return adminDb.collection(ORGANIZATION_COLLECTION).doc(organizationId);
}

// The permissions mirror stamped onto the User doc for a given active-org
// role. There is no dedicated admin set yet — admins get the owner set until
// M8-T1 introduces real role granularity (documented divergence).
export function permissionsForOrganizationRole(
  role: OrganizationMembership["role"],
): UserPermission[] {
  return role === "member" ? [...MEMBER_PERMISSIONS] : [...OWNER_PERMISSIONS];
}

// Admin Timestamp is wire-identical to the client Timestamp the collection
// types use (seconds/nanoseconds) but structurally lacks toJSON — same
// documented bridge cast the promotion routes use. serverTimestamp() cannot
// be used INSIDE array elements, hence a concrete now() for joinedAt.
function membershipJoinedAtNow(): OrganizationMembership["joinedAt"] {
  return Timestamp.now() as unknown as OrganizationMembership["joinedAt"];
}

function docTimestampNow(): UserDoc["updatedAt"] {
  return FieldValue.serverTimestamp() as unknown as UserDoc["updatedAt"];
}

// ============================================================================
// Read helpers
// ============================================================================

// Roster entry for (user, org) from the authoritative embedded list, or null
// (user missing / not a member). Doc-id read — no query, no index.
export async function getAdminUserMembership(
  userEmail: string,
  organizationId: string,
): Promise<OrganizationMembership | null> {
  const snap = await userRef(userEmail).get();
  if (!snap.exists) return null;
  const user = snap.data() as UserDoc;
  return findOrganizationMembership(user.organizations, organizationId);
}

export async function isAdminUserOrganizationMember(
  userEmail: string,
  organizationId: string,
): Promise<boolean> {
  return (await getAdminUserMembership(userEmail, organizationId)) !== null;
}

// ============================================================================
// Mutations
// ============================================================================

export interface AddAdminUserToOrganizationInput {
  userEmail: string;
  organizationId: string;
  joinMethod: Exclude<OrganizationMembership["joinMethod"], "created">;
  // Join flows only ever grant "member"; owner/admin roles are assigned by
  // org-management surfaces (M8-T1), never by a join.
  role?: "member";
  // Required only when the User doc does not exist yet (fresh signup /
  // Firebase-Auth user without a Firestore doc). Ignored for existing users.
  profile?: {
    uid: string;
    name?: string;
    avatarUrl?: string | null;
    emailVerified?: boolean;
  };
}

export type AddAdminUserToOrganizationResult =
  | { ok: true; status: "joined" | "already-member" }
  | {
      ok: false;
      reason: "organization-not-found" | "user-doc-missing-profile";
    };

// Adds a user to an organization: appends the roster membership, switches
// the active org (organizationId / organizationRole / permissions mirror —
// matching the client UX where joining lands you in the joined org), and
// increments Organization.memberCount — ONE transaction, so a failure leaves
// neither a dangling membership nor a drifted counter.
//
// Idempotent: joining an org the roster already contains is a no-op success
// ("already-member") — the counter does NOT move again, so retries are safe.
//
// AUTHORIZATION IS THE CALLER'S JOB: the route invoking this must have
// already validated the entitlement (invite code / invite link token match,
// or email-domain auto-join check). This DAL only owns the atomic write.
export async function addAdminUserToOrganization(
  input: AddAdminUserToOrganizationInput,
): Promise<AddAdminUserToOrganizationResult> {
  const role = input.role ?? "member";
  const uRef = userRef(input.userEmail);
  const oRef = organizationRef(input.organizationId);

  return adminDb.runTransaction<AddAdminUserToOrganizationResult>(
    async (tx) => {
      const [userSnap, orgSnap] = await Promise.all([
        tx.get(uRef),
        tx.get(oRef),
      ]);

      if (!orgSnap.exists) {
        return { ok: false, reason: "organization-not-found" };
      }

      const membership: OrganizationMembership = {
        organizationId: input.organizationId,
        role,
        joinedAt: membershipJoinedAtNow(),
        joinMethod: input.joinMethod,
      };

      if (userSnap.exists) {
        const user = userSnap.data() as UserDoc;
        if (
          findOrganizationMembership(user.organizations, input.organizationId)
        ) {
          return { ok: true, status: "already-member" };
        }

        tx.update(uRef, {
          organizationId: input.organizationId,
          organizationRole: role,
          organizations: FieldValue.arrayUnion(membership),
          permissions: permissionsForOrganizationRole(role),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        if (!input.profile) {
          return { ok: false, reason: "user-doc-missing-profile" };
        }

        const userEmail = input.userEmail.toLowerCase();
        const userDoc: UserDoc = {
          uid: input.profile.uid,
          name: input.profile.name ?? "",
          email: userEmail,
          organizationId: input.organizationId,
          organizationRole: role,
          organizations: [membership],
          emailVerified: input.profile.emailVerified ?? false,
          status: "active",
          permissions: permissionsForOrganizationRole(role),
          createdAt: docTimestampNow(),
          updatedAt: docTimestampNow(),
          ...(input.profile.avatarUrl
            ? { avatarUrl: input.profile.avatarUrl }
            : {}),
        };
        tx.create(uRef, userDoc);
      }

      tx.update(oRef, {
        memberCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, status: "joined" };
    },
  );
}

export interface CreateAdminOrganizationWithOwnerInput {
  ownerEmail: string;
  orgName: string;
  emailDomain: string | null;
  isPersonalEmail: boolean;
  // Required when the owner's User doc does not exist yet (signup); ignored
  // for existing users creating an additional organization.
  profile?: {
    uid: string;
    name?: string;
    avatarUrl?: string | null;
    emailVerified?: boolean;
  };
}

export type CreateAdminOrganizationWithOwnerResult =
  | {
      ok: true;
      organizationId: string;
      requiresDomainVerification: boolean;
    }
  | { ok: false; reason: "user-doc-missing-profile" };

// Creates a brand-new organization owned by the user and stamps the owner
// membership in the same transaction (server-side mirror of the client
// signupCreateOrgAndUser flow, minus its non-atomicity). New users get a
// full owner-shaped User doc; existing users get the owner membership
// appended and the new org made active.
export async function createAdminOrganizationWithOwner(
  input: CreateAdminOrganizationWithOwnerInput,
): Promise<CreateAdminOrganizationWithOwnerResult> {
  const ownerEmail = input.ownerEmail.toLowerCase();
  const orgType: OrganizationDoc["type"] = input.isPersonalEmail
    ? "workspace"
    : "organization";
  const requiresDomainVerification = !input.isPersonalEmail;

  const oRef = adminDb.collection(ORGANIZATION_COLLECTION).doc();
  const uRef = userRef(ownerEmail);

  const orgDoc: OrganizationDoc = {
    name: input.orgName,
    description: "",
    slug: generateSlug(input.orgName),
    type: orgType,
    status: "pending",
    domainVerified: false,
    inviteCode: generateInviteCode(),
    inviteCodeEnabled: true,
    inviteLinkToken: generateInviteToken(),
    inviteLinkEnabled: true,
    allowDomainAutoJoin: orgType === "organization",
    ownerId: ownerEmail,
    memberCount: 1,
    createdAt: docTimestampNow(),
    updatedAt: docTimestampNow(),
    ...(orgType === "organization" && input.emailDomain
      ? { domain: input.emailDomain }
      : {}),
  };

  const membership: OrganizationMembership = {
    organizationId: oRef.id,
    role: "owner",
    joinedAt: membershipJoinedAtNow(),
    joinMethod: "created",
  };

  return adminDb.runTransaction<CreateAdminOrganizationWithOwnerResult>(
    async (tx) => {
      const userSnap = await tx.get(uRef);

      if (userSnap.exists) {
        tx.update(uRef, {
          organizationId: oRef.id,
          organizationRole: "owner",
          organizations: FieldValue.arrayUnion(membership),
          permissions: permissionsForOrganizationRole("owner"),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        if (!input.profile) {
          return { ok: false, reason: "user-doc-missing-profile" };
        }

        const userDoc: UserDoc = {
          uid: input.profile.uid,
          name: input.profile.name ?? "",
          email: ownerEmail,
          organizationId: oRef.id,
          organizationRole: "owner",
          organizations: [membership],
          emailVerified: input.profile.emailVerified ?? false,
          status: "active",
          permissions: permissionsForOrganizationRole("owner"),
          createdAt: docTimestampNow(),
          updatedAt: docTimestampNow(),
          ...(input.profile.avatarUrl
            ? { avatarUrl: input.profile.avatarUrl }
            : {}),
        };
        tx.create(uRef, userDoc);
      }

      tx.create(oRef, orgDoc);

      return {
        ok: true,
        organizationId: oRef.id,
        requiresDomainVerification,
      };
    },
  );
}

export type SetAdminUserActiveOrganizationResult =
  | { ok: true; role: OrganizationMembership["role"] }
  | { ok: false; reason: "user-not-found" | "not-a-member" };

// Server-side org switcher: validates the target against the roster and
// updates the active-org mirror fields (organizationId / organizationRole /
// permissions) in one write. The client switcher (AuthContext) cannot update
// permissions under the new rules, so any surface that needs the permissions
// mirror re-stamped on switch must use this instead.
export async function setAdminUserActiveOrganization(
  userEmail: string,
  organizationId: string,
): Promise<SetAdminUserActiveOrganizationResult> {
  const uRef = userRef(userEmail);

  return adminDb.runTransaction<SetAdminUserActiveOrganizationResult>(
    async (tx) => {
      const snap = await tx.get(uRef);
      if (!snap.exists) return { ok: false, reason: "user-not-found" };

      const user = snap.data() as UserDoc;
      const membership = findOrganizationMembership(
        user.organizations,
        organizationId,
      );
      if (!membership) return { ok: false, reason: "not-a-member" };

      tx.update(uRef, {
        organizationId,
        organizationRole: membership.role,
        permissions: permissionsForOrganizationRole(membership.role),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, role: membership.role };
    },
  );
}
