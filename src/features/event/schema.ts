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
export const eventPageModeSchema = z.enum(["default", "custom", "redirect"]);

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function createDateTimeRangeSchema(options?: {
  disallowPastStartDate?: boolean;
  startDateMessage?: string;
}) {
  return z
    .object({
      startDate: z.string().min(1, "Start date is required"),
      startTime: z.string().min(1, "Start time is required"),
      endDate: z.string().min(1, "End date is required"),
      endTime: z.string().min(1, "End time is required"),
    })
    .refine(
      (value) => {
        if (!options?.disallowPastStartDate) {
          return true;
        }

        return value.startDate >= getTodayDateString();
      },
      {
        message:
          options?.startDateMessage ??
          "Start date cannot be earlier than today.",
        path: ["startDate"],
      },
    )
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
}

export const eventScheduleRangeSchema = createDateTimeRangeSchema();
export const eventRegistrationPeriodSchema = createDateTimeRangeSchema({
  disallowPastStartDate: true,
  startDateMessage: "Registration cannot start before today.",
});

export const eventPeriodSchema = z.record(z.string(), z.string());
export const eventRegistrationPeriodDocumentSchema = z.record(
  z.string(),
  z.string(),
);

export const eventFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().min(1, "Description is required"),
  capacity: z.coerce.number().int().min(1, "Capacity must be at least 1"),
  expectedGuests: z.coerce
    .number()
    .int()
    .min(0, "Expected guests cannot be negative"),
  eventPagePath: z.string().trim().optional(),
  formPath: z.string().trim().min(1, "Form path is required"),
  invoicePath: z.string().trim().default(""),
  organizationPath: z.string().trim().min(1, "Organization path is required"),
  timezone: z.string().trim().min(1, "Timezone is required"),
  allowOverlap: z.boolean(),
  status: eventStatusSchema,
  pageMode: eventPageModeSchema.default("default"),
  redirectUrl: z.string().trim().default(""),
  registrationPeriod: eventRegistrationPeriodSchema,
  periods: z
    .array(eventScheduleRangeSchema)
    .min(1, "Add at least one date and time range."),
}).superRefine((value, context) => {
  if (value.pageMode === "redirect" && value.redirectUrl.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Redirect URL is required when page mode is redirect.",
      path: ["redirectUrl"],
    });
  }
});

export const eventDocumentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().min(1, "Description is required"),
  capacity: z.coerce.number().int().min(1, "Capacity must be at least 1"),
  expectedGuests: z.coerce
    .number()
    .int()
    .min(0, "Expected guests cannot be negative"),
  eventPagePath: z.string().trim().optional(),
  formPath: z.string().trim().min(1, "Form path is required"),
  invoicePath: z.string().trim().default(""),
  organizationPath: z.string().trim().min(1, "Organization path is required"),
  timezone: z.string().trim().min(1, "Timezone is required"),
  allowOverlap: z.boolean(),
  status: eventStatusSchema,
  pageMode: eventPageModeSchema.default("default"),
  redirectUrl: z.string().trim().default(""),
  registrationPeriod: eventRegistrationPeriodDocumentSchema.optional(),
  periods: z.array(eventPeriodSchema).default([]),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export type EventFormValues = z.infer<typeof eventFormSchema>;
export type EventFormInput = z.input<typeof eventFormSchema>;
export type EventDocumentValues = z.infer<typeof eventDocumentSchema>;
export type EventScheduleRangeValues = z.infer<typeof eventScheduleRangeSchema>;
export type EventRegistrationPeriodValues = z.infer<
  typeof eventRegistrationPeriodSchema
>;
