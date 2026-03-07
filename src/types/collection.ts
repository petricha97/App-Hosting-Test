import type { Timestamp, FieldValue } from "firebase/firestore";

export type WithId<T> = T & { id: string };

export interface OrganizationDoc {
    name: string;
    description?: string;
    slug: string;
    type: "organization" | "workspace";
    status: "pending" | "verified" | "suspended";
    domain?: string;
    domainVerified: boolean;
    domainVerifiedAt?: Timestamp;
    inviteCode?: string;
    inviteCodeEnabled: boolean;
    inviteLinkToken?: string;
    inviteLinkEnabled: boolean;
    allowDomainAutoJoin: boolean;
    ownerId: string;
    memberCount: number;
    createdAt: Timestamp | FieldValue;
    updatedAt: Timestamp | FieldValue;
}

export interface OrganizationMembership {
    organizationId: string;
    role: "owner" | "admin" | "member";
    joinedAt: Timestamp | FieldValue;
    joinMethod: "created" | "invite_link" | "invite_code" | "domain_auto_join";
}

export type UserPermission =
    | "view:events" | "write:events"
    | "view:form" | "write:form"
    | "view:invoice" | "write:invoice"
    | "view:promotion" | "write:promotion"
    | "view:organization" | "write:organization"
    | "view:user" | "write:user";

export const OWNER_PERMISSIONS: UserPermission[] = [
    "view:events", "write:events",
    "view:form", "write:form",
    "view:invoice", "write:invoice",
    "view:promotion", "write:promotion",
    "view:organization", "write:organization",
    "view:user", "write:user",
];

export const MEMBER_PERMISSIONS: UserPermission[] = [
    "view:events",
    "view:form",
    "view:invoice",
    "view:promotion",
];

export interface UserDoc {
    uid: string;
    name: string;
    email: string;
    avatarUrl?: string;
    organizationId: string;
    organizationRole: "owner" | "admin" | "member";
    organizations: OrganizationMembership[];
    emailVerified: boolean;
    status: "active" | "pending" | "suspended";
    permissions: UserPermission[];
    createdAt: Timestamp | FieldValue;
    updatedAt: Timestamp | FieldValue;
    lastLoginAt?: Timestamp;
}

export interface InvitationDoc {
    organizationId: string;
    type: "email" | "link" | "code";
    email?: string;
    token?: string;
    code?: string;
    role: "admin" | "member";
    maxUses?: number;
    usedCount: number;
    expiresAt?: Timestamp;
    status: "active" | "expired" | "revoked";
    createdBy: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface DomainVerificationDoc {
    organizationId: string;
    domain: string;
    method: "email" | "dns_txt" | "dns_cname";
    verificationEmail?: string;
    verificationToken: string;
    dnsRecordType?: "TXT" | "CNAME";
    dnsRecordValue?: string;
    status: "pending" | "verified" | "failed" | "expired";
    attempts: number;
    lastAttemptAt?: Timestamp;
    verifiedAt?: Timestamp;
    expiresAt: Timestamp;
    initiatedBy: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface EventDoc {
    allowOverlap: boolean;
    capacity: number;
    createdAt: Timestamp;
    description: string;
    expectedGuests: number;
    formPath: string;
    invoicePath: string;
    name: string;
    organizationPath: string;
    periods: Array<Record<string, string>>;
    status: "Draft" | "Published";
    timezone: string;
    updatedAt: Timestamp;
}