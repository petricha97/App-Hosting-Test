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

import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Transaction,
  type UpdateData,
} from "firebase-admin/firestore";

import { adminDb } from "@/app/lib/firestore";
import {
  INVITATION_COLLECTION,
  getAdminInvitationByToken,
  isAdminInvitationExpired,
} from "@/lib/db/adminInvitation";
import {
  countAdminOrganizationOwnersInTransaction,
  deleteAdminOrganizationMemberInTransaction,
  putAdminOrganizationMemberInTransaction,
} from "@/lib/db/adminOrganizationMember";
import { findOrganizationMembership } from "@/lib/org-membership";
import { generateSlug } from "@/lib/org-utils";
import { generateInviteCode, generateInviteToken } from "@/lib/invite-utils";
import {
  EDITOR_PERMISSIONS,
  MEMBER_PERMISSIONS,
  OWNER_PERMISSIONS,
  type InvitationDoc,
  type OrganizationDoc,
  type OrganizationMembership,
  type OrganizationRole,
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
// role — the D3 matrix, a 4-way switch (M8-T1 spec §1 AC-1):
//   owner / admin -> OWNER_PERMISSIONS (D5: Admin is BYTE-IDENTICAL to Owner
//     at the permission-string layer; the real distinction is the D10
//     role-hierarchy guardrail on the member-management surface below, never
//     expressed as a UserPermission string)
//   editor        -> EDITOR_PERMISSIONS
//   viewer, and the legacy "member" alias (D2, permanent, zero-cost)
//                 -> MEMBER_PERMISSIONS
// Every membership-mutating flow (join, invite-accept, role-change) calls
// this to (re-)stamp UserDoc.permissions — the ~50 existing M1-M7 routes
// that gate on userDoc.permissions.includes(...) need ZERO code changes to
// correctly admit Owner/Admin/Editor and reject Viewer (D4).
export function permissionsForOrganizationRole(
  role: OrganizationMembership["role"],
): UserPermission[] {
  switch (role) {
    case "owner":
    case "admin":
      return [...OWNER_PERMISSIONS];
    case "editor":
      return [...EDITOR_PERMISSIONS];
    case "viewer":
    case "member":
    default:
      // Fail-closed default: any unexpected/corrupted stored role value
      // (not one of the 5 known strings) gets the lowest-privilege set,
      // never silently escalated.
      return [...MEMBER_PERMISSIONS];
  }
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
  // M8-T1 D7/D9: widened from "member"-only to accept any of the 4 real
  // roles EXCEPT "owner" — org creation has its own separate flow
  // (createAdminOrganizationWithOwner), never this one. Self-serve joins
  // (invite code / invite link / domain auto-join) omit this and default to
  // "viewer" (D9 — the lowest tier; an unvetted shared-secret join is
  // weaker provenance than an explicit per-email invite). The invite-accept
  // flow (acceptAdminInvitation, below) is the one caller that passes a
  // pre-assigned "admin"/"editor"/"viewer" role explicitly.
  role?: Exclude<OrganizationRole, "owner">;
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

// The shared join CORE — every mutation, either a top-level transaction or
// a step nested inside a LARGER transaction (acceptAdminInvitation below,
// which also needs to touch the Invitation doc in the SAME transaction),
// funnels through this one function so the roster write, the
// permissions-mirror stamp, the memberCount increment, and the D12
// reverse-index write can never drift apart or be duplicated in two places.
// Callers must supply an ALREADY-OPEN transaction and must not have issued
// any writes in it yet (Firestore requires all reads before all writes;
// this function's own tx.get calls would fail after a prior write).
async function applyOrganizationJoinInTransaction(
  tx: Transaction,
  input: AddAdminUserToOrganizationInput,
): Promise<AddAdminUserToOrganizationResult> {
  const role: Exclude<OrganizationRole, "owner"> = input.role ?? "viewer";
  const userEmail = input.userEmail.toLowerCase();
  const uRef = userRef(userEmail);
  const oRef = organizationRef(input.organizationId);

  const [userSnap, orgSnap] = await Promise.all([tx.get(uRef), tx.get(oRef)]);

  if (!orgSnap.exists) {
    return { ok: false, reason: "organization-not-found" };
  }

  const membership: OrganizationMembership = {
    organizationId: input.organizationId,
    role,
    joinedAt: membershipJoinedAtNow(),
    joinMethod: input.joinMethod,
  };

  let name: string;
  let status: UserDoc["status"];

  if (userSnap.exists) {
    const user = userSnap.data() as UserDoc;
    if (findOrganizationMembership(user.organizations, input.organizationId)) {
      return { ok: true, status: "already-member" };
    }

    tx.update(uRef, {
      organizationId: input.organizationId,
      organizationRole: role,
      organizations: FieldValue.arrayUnion(membership),
      permissions: permissionsForOrganizationRole(role),
      updatedAt: FieldValue.serverTimestamp(),
    });
    name = user.name;
    status = user.status;
  } else {
    if (!input.profile) {
      return { ok: false, reason: "user-doc-missing-profile" };
    }

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
    name = userDoc.name;
    status = userDoc.status;
  }

  tx.update(oRef, {
    memberCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // D12: the reverse-index row is written in the SAME transaction as the
  // roster write above — it can never drift out of sync.
  putAdminOrganizationMemberInTransaction(tx, {
    organizationId: input.organizationId,
    email: userEmail,
    role,
    name,
    status,
  });

  return { ok: true, status: "joined" };
}

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
// email-domain auto-join check, or — M8-T1 — a validated invitation via
// acceptAdminInvitation, below, which calls the same core transactionally).
// This DAL only owns the atomic write.
export async function addAdminUserToOrganization(
  input: AddAdminUserToOrganizationInput,
): Promise<AddAdminUserToOrganizationResult> {
  return adminDb.runTransaction<AddAdminUserToOrganizationResult>((tx) =>
    applyOrganizationJoinInTransaction(tx, input),
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
      let ownerName: string;

      if (userSnap.exists) {
        const user = userSnap.data() as UserDoc;
        ownerName = user.name;
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
        ownerName = userDoc.name;
      }

      tx.create(oRef, orgDoc);

      // D12: the brand-new owner's reverse-index row, same transaction —
      // every org's Owner count starts correctly at 1 from the moment the
      // org exists (the last-Owner guardrail below depends on this).
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: oRef.id,
        email: ownerEmail,
        role: "owner",
        name: ownerName,
        status: "active",
      });

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

// ============================================================================
// M8-T1 — Real IAM: invite-accept flow, role change, and removal.
// Spec: agents/docs/specs/m8-real-iam.md §4/§5/D10.
// ============================================================================

// D10 role-hierarchy guardrail: is `role` an "upper tier" (Owner/Admin) that
// only an OWNER caller may create, target, or set? The legacy "member"
// alias is never upper tier (D2 — it is Viewer).
function isUpperTierRole(role: OrganizationRole): boolean {
  return role === "owner" || role === "admin";
}

// Same predicate, named for the "is this caller even allowed to manage
// members at all" read site (Owner/Admin both hold write:user, D3) — kept
// as a distinct alias so call sites read naturally; behavior is identical
// to isUpperTierRole.
const isManagerRole = isUpperTierRole;

// Predicate-based array update (spec §5 — explicitly NOT arrayUnion; see
// withoutMembership below for the matching removal rationale). Used for an
// in-place role change: the OTHER fields of the membership entry (joinedAt,
// joinMethod) are preserved untouched.
function withUpdatedMembershipRole(
  memberships: OrganizationMembership[],
  organizationId: string,
  newRole: OrganizationRole,
): OrganizationMembership[] {
  return memberships.map((m) =>
    m.organizationId === organizationId ? { ...m, role: newRole } : m,
  );
}

// Predicate-based removal (spec §5, explicit instruction): NOT a raw
// arrayRemove, because arrayRemove needs EXACT map equality and the
// membership's own joinedAt Timestamp makes that unreliable — the same
// reason findOrganizationMembership (org-membership.ts) already uses
// predicate matching instead of equality.
function withoutMembership(
  memberships: OrganizationMembership[],
  organizationId: string,
): OrganizationMembership[] {
  return memberships.filter((m) => m.organizationId !== organizationId);
}

export type AcceptAdminInvitationResult =
  | { ok: true; organizationId: string; role: InvitationDoc["role"] }
  // Unknown token, or the invitation is no longer pending (already
  // accepted/revoked) or has expired — spec §4 deliberately collapses all
  // of these into ONE generic rejection ("this invitation is no longer
  // valid"), never distinguishing which for the caller.
  | { ok: false; code: "INVALID" }
  // THE security-critical check (spec §4): the AUTHENTICATED caller's own
  // token email does not case-insensitively match invitation.email.
  | { ok: false; code: "EMAIL_MISMATCH" }
  | { ok: false; code: "ORGANIZATION_NOT_FOUND" }
  // The invitee has no Firestore User doc yet AND no `profile` was supplied
  // — the route's brand-new-signup branch must pass one (spec §4's
  // "new-user case").
  | { ok: false; code: "USER_PROFILE_REQUIRED" };

// Resolves an invitation by its opaque bearer token, validates it, and — on
// success — joins the AUTHENTICATED caller to the invitation's organization
// at the invitation's pre-assigned role, marks the invitation accepted, and
// writes the D12 reverse-index row, ALL IN ONE TRANSACTION (spec §4).
//
// `callerEmail` MUST be the caller's own verified token email (decodeUser's
// output, or the equivalent from an already-verified session) — never a
// client-supplied field independent of that verification. This function
// performs the email-match check itself (defense in depth: once before
// opening the transaction as a fast-fail, once again inside the transaction
// against the freshly re-read doc), but it does NOT re-verify the token
// itself — that is the caller's (the route's) job, exactly like every other
// DAL function in this codebase that receives an already-authenticated
// identity as a plain string.
export async function acceptAdminInvitation(input: {
  token: string;
  callerEmail: string;
  // Only consulted when the invitee's User doc does not exist yet (brand
  // new signup) — same shape/semantics as
  // AddAdminUserToOrganizationInput["profile"].
  profile?: AddAdminUserToOrganizationInput["profile"];
}): Promise<AcceptAdminInvitationResult> {
  const callerEmail = input.callerEmail.trim().toLowerCase();

  const initial = await getAdminInvitationByToken(input.token);
  if (!initial) return { ok: false, code: "INVALID" };
  if (initial.email !== callerEmail) {
    return { ok: false, code: "EMAIL_MISMATCH" };
  }

  const invRef = adminDb.collection(INVITATION_COLLECTION).doc(initial.id);

  return adminDb.runTransaction<AcceptAdminInvitationResult>(async (tx) => {
    const invSnap = await tx.get(invRef);
    if (!invSnap.exists) return { ok: false, code: "INVALID" };
    const invitation = invSnap.data() as InvitationDoc;

    // Re-verified against the FRESH read (defense in depth — the doc could
    // have changed between the pre-transaction lookup above and this read,
    // though email itself is immutable post-create).
    if (invitation.email !== callerEmail) {
      return { ok: false, code: "EMAIL_MISMATCH" };
    }
    if (
      invitation.status !== "pending" ||
      isAdminInvitationExpired(invitation)
    ) {
      return { ok: false, code: "INVALID" };
    }

    const joinResult = await applyOrganizationJoinInTransaction(tx, {
      userEmail: callerEmail,
      organizationId: invitation.organizationId,
      joinMethod: "invite_email",
      role: invitation.role,
      profile: input.profile,
    });

    if (!joinResult.ok) {
      return joinResult.reason === "organization-not-found"
        ? { ok: false, code: "ORGANIZATION_NOT_FOUND" }
        : { ok: false, code: "USER_PROFILE_REQUIRED" };
    }

    // "joined" or "already-member" both count as a successful accept — the
    // invitation's own job is "prove this email was invited," which is
    // satisfied either way (idempotent-safe re-accept, spec §4 AC-4).
    tx.update(invRef, {
      status: "accepted",
      acceptedAt: FieldValue.serverTimestamp(),
      acceptedBy: callerEmail,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      organizationId: invitation.organizationId,
      role: invitation.role,
    };
  });
}

// Shared caller/target roster resolution for changeAdminMemberRole /
// removeAdminMember — both need "the caller's OWN current role in this org"
// (re-derived fresh from the roster, never trusted from a param, matching
// D11's "next request" freshness posture) and "the target's current
// membership entry" (or a typed not-found).
async function resolveCallerAndTargetMembership(
  tx: Transaction,
  organizationId: string,
  callerEmail: string,
  targetEmail: string,
): Promise<
  | {
      ok: true;
      targetRef: ReturnType<typeof userRef>;
      callerRole: OrganizationRole;
      targetUser: UserDoc;
      targetMembership: OrganizationMembership;
    }
  | { ok: false; code: "CALLER_NOT_AUTHORIZED" | "TARGET_NOT_FOUND" }
> {
  const callerRef = userRef(callerEmail);
  const targetRef = userRef(targetEmail);

  // Self-action (caller acting on their own row, e.g. self-demote/remove):
  // read the SAME doc once rather than issuing two reads of the same ref.
  const callerSnap = await tx.get(callerRef);
  const targetSnap =
    callerEmail === targetEmail ? callerSnap : await tx.get(targetRef);

  const callerMembership = callerSnap.exists
    ? findOrganizationMembership(
        (callerSnap.data() as UserDoc).organizations,
        organizationId,
      )
    : null;
  if (!callerMembership || !isManagerRole(callerMembership.role)) {
    return { ok: false, code: "CALLER_NOT_AUTHORIZED" };
  }

  if (!targetSnap.exists) {
    return { ok: false, code: "TARGET_NOT_FOUND" };
  }
  const targetUser = targetSnap.data() as UserDoc;
  const targetMembership = findOrganizationMembership(
    targetUser.organizations,
    organizationId,
  );
  if (!targetMembership) {
    return { ok: false, code: "TARGET_NOT_FOUND" };
  }

  return {
    ok: true,
    targetRef,
    callerRole: callerMembership.role,
    targetUser,
    targetMembership,
  };
}

export type ChangeAdminMemberRoleResult =
  | { ok: true; role: OrganizationRole }
  | { ok: false; code: "CALLER_NOT_AUTHORIZED" }
  // Target is not a member of this org at all — route 404s (spec §7 AC-2,
  // IDOR-safe convention), never 403 (never confirms/denies existence).
  | { ok: false; code: "TARGET_NOT_FOUND" }
  // D10: an Admin caller touched an Owner/Admin row, or tried to set
  // anyone's role to Owner/Admin.
  | { ok: false; code: "HIERARCHY_VIOLATION" }
  // The target is the org's sole Owner and this change would leave zero.
  | { ok: false; code: "LAST_OWNER" };

// Changes a member's role, enforcing D10's hierarchy guardrail and the
// last-Owner guardrail (spec §5) — one transaction: the roster array entry,
// the (possibly-active-org) permissions mirror, and the D12 reverse-index
// row all move together.
export async function changeAdminMemberRole(input: {
  organizationId: string;
  callerEmail: string;
  targetEmail: string;
  // Never the legacy "member" alias — new writes always use a real role.
  newRole: Exclude<OrganizationRole, "member">;
}): Promise<ChangeAdminMemberRoleResult> {
  const callerEmail = input.callerEmail.trim().toLowerCase();
  const targetEmail = input.targetEmail.trim().toLowerCase();

  return adminDb.runTransaction<ChangeAdminMemberRoleResult>(async (tx) => {
    const resolved = await resolveCallerAndTargetMembership(
      tx,
      input.organizationId,
      callerEmail,
      targetEmail,
    );
    if (!resolved.ok) return resolved;
    const { targetRef, callerRole, targetUser, targetMembership } = resolved;

    if (callerRole !== "owner") {
      if (
        isUpperTierRole(targetMembership.role) ||
        isUpperTierRole(input.newRole)
      ) {
        return { ok: false, code: "HIERARCHY_VIOLATION" };
      }
    }

    if (targetMembership.role === "owner" && input.newRole !== "owner") {
      const ownerCount = await countAdminOrganizationOwnersInTransaction(
        tx,
        input.organizationId,
      );
      if (ownerCount <= 1) {
        return { ok: false, code: "LAST_OWNER" };
      }
    }

    const updatedMemberships = withUpdatedMembershipRole(
      targetUser.organizations,
      input.organizationId,
      input.newRole,
    );
    const targetUpdate: Record<string, unknown> = {
      organizations: updatedMemberships,
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Re-stamp the active-org mirror fields only when this IS the target's
    // CURRENTLY active org — the change is correct either way on the
    // target's next request (D11), this just keeps the mirror accurate
    // immediately when it's already pointed here.
    if (targetUser.organizationId === input.organizationId) {
      targetUpdate.organizationRole = input.newRole;
      targetUpdate.permissions = permissionsForOrganizationRole(input.newRole);
    }
    tx.update(targetRef, targetUpdate as UpdateData<DocumentData>);

    putAdminOrganizationMemberInTransaction(tx, {
      organizationId: input.organizationId,
      email: targetEmail,
      role: input.newRole,
      name: targetUser.name,
      status: targetUser.status,
    });

    return { ok: true, role: input.newRole };
  });
}

export type RemoveAdminMemberResult =
  | { ok: true }
  | { ok: false; code: "CALLER_NOT_AUTHORIZED" }
  | { ok: false; code: "TARGET_NOT_FOUND" }
  | { ok: false; code: "HIERARCHY_VIOLATION" }
  | { ok: false; code: "LAST_OWNER" };

// Removes a member from an organization, enforcing the same D10 hierarchy
// + last-Owner guardrails as changeAdminMemberRole — one transaction:
// read-modify-write UserDoc.organizations[] (predicate filter, NOT
// arrayRemove — see withoutMembership), decrement Organization.memberCount,
// delete the D12 reverse-index row (spec §5).
//
// If the removed user's currently-active org IS the one they were just
// removed from, no special re-pointing logic runs here — deliberately (spec
// §5): resolveActiveOrganizationId() (org-membership.ts) already treats a
// stale active organizationId with no matching roster entry as "not a
// member," so their very next request 403s/redirects like any other
// stale-active-org case already handled elsewhere in this codebase.
export async function removeAdminMember(input: {
  organizationId: string;
  callerEmail: string;
  targetEmail: string;
}): Promise<RemoveAdminMemberResult> {
  const callerEmail = input.callerEmail.trim().toLowerCase();
  const targetEmail = input.targetEmail.trim().toLowerCase();

  return adminDb.runTransaction<RemoveAdminMemberResult>(async (tx) => {
    const resolved = await resolveCallerAndTargetMembership(
      tx,
      input.organizationId,
      callerEmail,
      targetEmail,
    );
    if (!resolved.ok) return resolved;
    const { targetRef, callerRole, targetUser, targetMembership } = resolved;

    if (callerRole !== "owner" && isUpperTierRole(targetMembership.role)) {
      return { ok: false, code: "HIERARCHY_VIOLATION" };
    }

    if (targetMembership.role === "owner") {
      const ownerCount = await countAdminOrganizationOwnersInTransaction(
        tx,
        input.organizationId,
      );
      if (ownerCount <= 1) {
        return { ok: false, code: "LAST_OWNER" };
      }
    }

    const oRef = organizationRef(input.organizationId);
    const updatedMemberships = withoutMembership(
      targetUser.organizations,
      input.organizationId,
    );
    tx.update(targetRef, {
      organizations: updatedMemberships,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(oRef, {
      memberCount: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    deleteAdminOrganizationMemberInTransaction(
      tx,
      input.organizationId,
      targetEmail,
    );

    return { ok: true };
  });
}
