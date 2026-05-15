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
  | "view:events"
  | "write:events"
  | "view:form"
  | "write:form"
  | "view:invoice"
  | "write:invoice"
  | "view:promotion"
  | "write:promotion"
  | "view:organization"
  | "write:organization"
  | "view:user"
  | "write:user";

export const OWNER_PERMISSIONS: UserPermission[] = [
  "view:events",
  "write:events",
  "view:form",
  "write:form",
  "view:invoice",
  "write:invoice",
  "view:promotion",
  "write:promotion",
  "view:organization",
  "write:organization",
  "view:user",
  "write:user",
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

export interface ConditionRule {
  field: string;
  operator: string;
  value: string | number;
}

export interface PromotionTemplateDoc {
  organizationId: string;
  name: string;
  description?: string | null;
  discountType?: string | null;
  discountValue?: number | null;
  conditions: ConditionRule[];
  // When true, attendees must enter promoCode to claim the discount.
  // When false, the discount auto-applies if all conditions are met.
  enablePromoCode: boolean;
  promoCode?: string | null;
  isArchived?: boolean;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface EventPromotionDoc {
  organizationId: string;
  templateId: string;
  inheritFromParent: boolean;
  name: string;
  description?: string | null;
  discountType?: string | null;
  discountValue?: number | null;
  conditions: ConditionRule[];
  enablePromoCode: boolean;
  promoCode?: string | null;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface TodoDoc {
  uid: string;
  title: string;
  completed: boolean;
  createdAt: Timestamp | FieldValue;
}

export interface EventDoc {
  allowOverlap: boolean;
  capacity: number;
  createdAt: Timestamp | FieldValue;
  description: string;
  expectedGuests: number;
  eventPagePath?: string;
  formPath: string;
  invoicePath: string;
  name: string;
  organizationPath: string;
  pageMode: "default" | "custom" | "redirect";
  redirectUrl: string;
  registrationPeriod?: Record<string, string>;
  periods: Array<Record<string, string>>;
  status: "Draft" | "Published";
  timezone: string;
  updatedAt: Timestamp | FieldValue;
}

export type FormFieldType = "text" | "email" | "textarea";
export type FormFieldOrigin = "mandatory" | "template" | "event";

export type FormStatus = "draft" | "published";
export type FormTemplateStatus = "active" | "archived";

export interface FormFieldDoc {
  id: string;
  key: string;
  label: string;
  type: FormFieldType;
  placeholder: string;
  helpText: string;
  required: boolean;
  isMandatory: boolean;
  order: number;
  origin?: FormFieldOrigin;
  sourceTemplateFieldId?: string;
  rows?: number;
}

export interface FormTemplateLinkDoc {
  templateId: string;
  templateVersion: number;
  detached: boolean;
  appliedAt: Timestamp | FieldValue;
}

export interface FormDoc {
  eventId: string;
  organizationId: string;
  title: string;
  status: FormStatus;
  fields: FormFieldDoc[];
  templateLink?: FormTemplateLinkDoc;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface FormTemplateDoc {
  organizationId: string;
  title: string;
  description: string;
  status: FormTemplateStatus;
  version: number;
  fields: FormFieldDoc[];
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface FormDataDoc {
  formId: string;
  eventId: string;
  organizationId: string;
  submission: Record<string, string>;
  submittedAt: Timestamp | FieldValue;
}

export interface EventPageDoc {
  eventId: string;
  organizationId: string;
  title: string;
  status: "draft" | "published";
  storagePrefix: string;
  draftContent: Record<string, unknown>;
  publishedContent: Record<string, unknown> | null;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}
