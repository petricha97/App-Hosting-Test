// Client-safe RHF/Zod schemas for the M6-T2 emails screen. Deliberately
// SEPARATE from src/lib/email/schemas.ts (marked "server-only" — importing
// it into a "use client" component would break the client bundle). The
// server routes remain the source of truth for validation (defense in
// depth, same posture as every other RHF dialog in this app); these mirror
// the bounds only for fast client-side feedback.
import { z } from "zod";

export const EMAIL_EDITOR_NAME_MAX = 120;
export const EMAIL_EDITOR_SUBJECT_MAX = 255;

export const emailGroupOptionSchema = z.enum([
  "pre-event",
  "post-registration",
  "debt-chase",
]);

export const emailAudienceOptionSchema = z.enum([
  "all-invitees",
  "abandoned",
  "pending-approval",
  "accepted-paid",
  "accepted-invoice",
  "accepted-all",
]);

// M6-T4 (spec §2): the RHF-side mirror of EmailPuckBlock — a stable id, one
// of the 8 email-safe types (see EMAIL_SAFE_BLOCK_TYPES,
// src/features/emails/types.ts), and an opaque props bag. This is a SHAPE
// check only (fast client feedback, same posture as every other schema in
// this file) — the server's per-type prop schemas (src/lib/email/schemas.ts,
// Backend scope) remain the authoritative validation, re-run at both write
// and render time per spec §3.1.
export const EMAIL_EDITOR_BODY_BLOCKS_MAX = 20;

export const emailEditorBodyBlockSchema = z.object({
  id: z.string(),
  type: z.string(),
  props: z.record(z.string(), z.unknown()),
});

export const emailBodyModeSchema = z.enum(["text", "blocks"]);

export const emailEditorFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(
      EMAIL_EDITOR_NAME_MAX,
      `Name must be ${EMAIL_EDITOR_NAME_MAX} characters or fewer.`,
    ),
  group: emailGroupOptionSchema,
  triggerType: z.enum(["manual", "scheduled"]),
  // "" | "YYYY-MM-DDTHH:MM" (datetime-local input value).
  scheduledAt: z.string(),
  audience: emailAudienceOptionSchema,
  enabled: z.boolean(),
  subject: z
    .string()
    .max(
      EMAIL_EDITOR_SUBJECT_MAX,
      `Subject must be ${EMAIL_EDITOR_SUBJECT_MAX} characters or fewer.`,
    ),
  body: z.string(),
  // M6-T4 — additive fields (spec §2 "join the same editability bucket as
  // subject/body"). Default "text"/[] so buildDefaultValues never needs a
  // definition to carry them (legacy docs / Backend-not-landed-yet gap).
  bodyMode: emailBodyModeSchema,
  bodyBlocks: z
    .array(emailEditorBodyBlockSchema)
    .max(
      EMAIL_EDITOR_BODY_BLOCKS_MAX,
      `A block-designed email may hold at most ${EMAIL_EDITOR_BODY_BLOCKS_MAX} blocks.`,
    ),
});

export type EmailEditorFormValues = z.infer<typeof emailEditorFormSchema>;

export const senderSettingsFormSchema = z.object({
  fromName: z.string().trim().min(1, "Sender name is required.").max(100),
  fromAddress: z.string().trim().min(1, "From address is required.").max(254),
  replyTo: z.string().trim().max(254),
});

export type SenderSettingsFormValues = z.infer<typeof senderSettingsFormSchema>;

export const testSendFormSchema = z.object({
  recipientEmail: z
    .string()
    .trim()
    .min(1, "Enter an email address.")
    .email("Enter a valid email address."),
});

export type TestSendFormValues = z.infer<typeof testSendFormSchema>;
