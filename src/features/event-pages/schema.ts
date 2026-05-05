import type { FieldValue, Timestamp } from "firebase/firestore";
import { z } from "zod";

const firestoreTimestampSchema = z.custom<Timestamp | FieldValue>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    ("seconds" in value ||
      typeof (value as { toDate?: unknown }).toDate === "function"),
  "Expected a Firestore timestamp-like value",
);

const puckBlockSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1).optional(),
  props: z
    .record(z.string(), z.unknown())
    .default({})
    .refine(
      (value) =>
        typeof value.id === "string" && value.id.trim().length > 0,
      "Each page block must include props.id",
    ),
});

export const eventPageContentSchema = z.object({
  content: z.array(puckBlockSchema).default([]),
  root: z.record(z.string(), z.unknown()).default({}),
  zones: z.record(z.string(), z.unknown()).default({}),
});

export const eventPageStatusSchema = z.enum(["draft", "published"]);

export const eventPageDocumentSchema = z.object({
  eventId: z.string().min(1),
  organizationId: z.string().min(1),
  title: z.string().trim().min(1),
  status: eventPageStatusSchema,
  storagePrefix: z.string().trim().min(1),
  draftContent: eventPageContentSchema,
  publishedContent: eventPageContentSchema.nullable(),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export const saveEventPageDraftSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  draftContent: eventPageContentSchema,
});

export type EventPageContentValues = z.infer<typeof eventPageContentSchema>;
export type EventPageDocumentValues = z.infer<typeof eventPageDocumentSchema>;
export type SaveEventPageDraftValues = z.infer<typeof saveEventPageDraftSchema>;
