import { z } from "zod";

// ============================================================================
// Auth Schemas
// ============================================================================

export const loginSchema = z.object({
  email: z.email("Enter a valid email."),
  password: z.string().min(1, "Password is required."),
});
export type LoginValues = z.infer<typeof loginSchema>;

// ============================================================================
// Organization Schemas
// ============================================================================

export const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(100, "Name is too long."),
  type: z.enum(["organization", "workspace"]),
  domain: z.string().optional(),
});

export type CreateOrganizationValues = z.infer<typeof createOrganizationSchema>;

export const organizationSettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(100, "Name is too long."),
  description: z.string().max(500, "Description is too long.").optional(),
  inviteCodeEnabled: z.boolean(),
  inviteLinkEnabled: z.boolean(),
  allowDomainAutoJoin: z.boolean(),
});

export type OrganizationSettingsValues = z.infer<
  typeof organizationSettingsSchema
>;

// ============================================================================
// Signup Wizard Schemas
// ============================================================================

export const credentialsStepSchema = z
  .object({
    name: z.string().trim().max(80, "Name is too long.").optional(),
    email: z.email("Enter a valid email."),
    password: z
      .string()
      .min(8, "Use at least 8 characters.")
      .regex(/[A-Za-z]/, "Include at least one letter.")
      .regex(/[0-9]/, "Include at least one number."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export type CredentialsStepValues = z.infer<typeof credentialsStepSchema>;

export const organizationStepSchema = z.object({
  action: z.enum(["create", "join", "auto-join"]),
  organizationName: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(100, "Name is too long.")
    .optional(),
  organizationType: z.enum(["organization", "workspace"]).optional(),
  inviteCode: z.string().optional(),
  existingOrgId: z.string().optional(),
});

export type OrganizationStepValues = z.infer<typeof organizationStepSchema>;

export const verificationStepSchema = z.object({
  method: z.enum(["email", "dns_txt"]).optional(),
  verificationEmail: z.enum(["admin", "webmaster"]).optional(),
  skipVerification: z.boolean().optional(),
});

export type VerificationStepValues = z.infer<typeof verificationStepSchema>;

// ============================================================================
// Join Organization Schemas
// ============================================================================

export const joinByCodeSchema = z.object({
  code: z
    .string()
    .min(6, "Code must be at least 6 characters.")
    .max(8, "Code must be at most 8 characters.")
    .regex(/^[A-Z0-9]+$/, "Code must contain only letters and numbers."),
});

export type JoinByCodeValues = z.infer<typeof joinByCodeSchema>;

export const joinOrganizationSchema = z.object({
  method: z.enum(["invite_code", "invite_link", "domain"]),
  code: z.string().optional(),
  token: z.string().optional(),
});

export type JoinOrganizationValues = z.infer<typeof joinOrganizationSchema>;

// ============================================================================
// Invitation Schemas
// ============================================================================
// M8-T1 (spec: agents/docs/specs/m8-real-iam.md §3, D7): replaces the prior
// type: "email"|"link"|"code" shape — dead code, zero imports anywhere,
// confirmed by exhaustive grep before this ticket. The "link"/"code"
// invitation variants it anticipated are permanently out of scope (D7): they
// would just re-implement the already-shipped Organization.inviteCode /
// inviteLinkToken shared-secret flows a second, redundant way. The real
// shape is narrower: one email, one pre-assigned role (never "owner" — D10,
// an invitation can never mint an Owner).

export const createInvitationSchema = z.object({
  email: z.email("Enter a valid email."),
  role: z.enum(["admin", "editor", "viewer"]),
});

export type CreateInvitationValues = z.infer<typeof createInvitationSchema>;

// ============================================================================
// Domain Verification Schemas
// ============================================================================

export const domainVerificationSchema = z.object({
  method: z.enum(["email", "dns_txt"]),
  email: z.enum(["admin", "webmaster"]).optional(),
});

export type DomainVerificationValues = z.infer<typeof domainVerificationSchema>;
