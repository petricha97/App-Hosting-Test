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

export const eventStatusSchema = z.enum(["Draft", "Published"]);

export const eventScheduleRangeSchema = z
  .object({
    startDate: z.string().min(1, "Start date is required"),
    startTime: z.string().min(1, "Start time is required"),
    endDate: z.string().min(1, "End date is required"),
    endTime: z.string().min(1, "End time is required"),
  })
  .refine(
    (value) => {
      const start = new Date(`${value.startDate}T${value.startTime}`);
      const end = new Date(`${value.endDate}T${value.endTime}`);

      return !Number.isNaN(start.getTime()) &&
        !Number.isNaN(end.getTime()) &&
        end.getTime() >= start.getTime();
    },
    {
      message: "End date and time must be after the start date and time.",
      path: ["endTime"],
    },
  );

export const eventPeriodSchema = z.record(z.string(), z.string());

export const eventFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().min(1, "Description is required"),
  capacity: z.coerce.number().int().min(1, "Capacity must be at least 1"),
  expectedGuests: z.coerce
    .number()
    .int()
    .min(0, "Expected guests cannot be negative"),
  formPath: z.string().trim().min(1, "Form path is required"),
  invoicePath: z.string().trim().default(""),
  organizationPath: z.string().trim().min(1, "Organization path is required"),
  timezone: z.string().trim().min(1, "Timezone is required"),
  allowOverlap: z.boolean(),
  status: eventStatusSchema,
  periods: z
    .array(eventScheduleRangeSchema)
    .min(1, "Add at least one date and time range."),
});

export const eventDocumentSchema = eventFormSchema.extend({
  periods: z.array(eventPeriodSchema).default([]),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export type EventFormValues = z.infer<typeof eventFormSchema>;
export type EventFormInput = z.input<typeof eventFormSchema>;
export type EventDocumentValues = z.infer<typeof eventDocumentSchema>;
export type EventScheduleRangeValues = z.infer<typeof eventScheduleRangeSchema>;
