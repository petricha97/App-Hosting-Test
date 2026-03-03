import { z } from "zod";

const passwordSchema = z.string()
    .min(8, "Use at least 8 characters.")
    .regex(/[A-Za-z]/, "Include at least one letter.")
    .regex(/[0-9]/, "Include at least one number.");

// ── Master schema — all signup fields in one place ───────────────────────────
export const signupSchema = z.object({
    // Step 1 — Credentials
    name: z.string().trim().max(80, "Name is too long.").optional(),
    email: z.email("Enter a valid email."),
    password: passwordSchema,
    confirmPassword: z.string(),
    // Step 2 — Organization
    action: z.enum(["create", "join", "auto-join"]),
    organizationName: z.string().trim().min(2, "Name must be at least 2 characters.").max(100, "Name is too long.").optional(),
    inviteCode: z.string().optional(),
    existingOrgId: z.string().optional(),
});

// ── Per-step schemas via .pick() ─────────────────────────────────────────────
export const credentialsSchema = signupSchema
    .pick({ name: true, email: true, password: true, confirmPassword: true })
    .refine((data) => data.password === data.confirmPassword, {
        path: ["confirmPassword"],
        message: "Passwords do not match.",
    });

export type CredentialsValues = z.infer<typeof credentialsSchema>;

export const organizationSchema = signupSchema.pick({
    action: true,
    organizationName: true,
    inviteCode: true,
    existingOrgId: true,
});

export type OrganizationValues = z.infer<typeof organizationSchema>;
