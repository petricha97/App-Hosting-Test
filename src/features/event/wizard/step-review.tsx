"use client";

import type { ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";

import { cn } from "@/lib/utils";
import type {
  EventFormInput,
  EventFormValues,
  EventScheduleRangeValues,
} from "@/features/event/schema";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface StepReviewProps {
  form: UseFormReturn<EventFormInput, undefined, EventFormValues>;
  onEdit: (index: number) => void;
}

const PAGE_MODE_LABELS: Record<EventFormValues["pageMode"], string> = {
  default: "Use default event page",
  custom: "Design a custom page later",
  redirect: "Redirect to my own page",
};

/** Format a stored ISO date (YYYY-MM-DD) + optional time as "DD/MM/YYYY HH:MM"
 *  for the read-only summary; returns "—" when the date is missing/malformed. */
function formatDateTime(date?: string, time?: string): string {
  if (!date) return "—";
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return "—";
  return `${day}/${month}/${year}${time ? ` ${time}` : ""}`;
}

/** Format one date range as "start → end" for the summary. */
function formatRange(range: Partial<EventScheduleRangeValues>): string {
  return `${formatDateTime(range.startDate, range.startTime)} → ${formatDateTime(range.endDate, range.endTime)}`;
}

interface ReviewGroupProps {
  title: string;
  onEdit: () => void;
  rows: Array<{ label: string; value: ReactNode }>;
}

/** One titled summary section (label/value rows) with an "Edit" button that
 *  jumps back to the relevant step. */
function ReviewGroup({ title, onEdit, rows }: ReviewGroupProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-orange-700 hover:text-orange-900"
          onClick={onEdit}
        >
          Edit
        </Button>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(120px,34%)_1fr]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="pt-1.5 text-xs text-slate-500">{row.label}</dt>
            <dd className="pt-1.5 text-sm tabular-nums text-slate-800">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** CREATE wizard — Step 5. A read-only recap of every step (with per-section
 *  Edit jumps) plus the Draft-vs-Publish choice that sets `status` before submit. */
export function StepReview({ form, onEdit }: StepReviewProps) {
  const values = form.watch();

  return (
    <div className="space-y-4">
      <ReviewGroup
        title="Event details"
        onEdit={() => onEdit(0)}
        rows={[
          { label: "Name", value: values.name || "—" },
          { label: "Description", value: values.description || "—" },
          { label: "Capacity", value: String(values.capacity ?? "—") },
          {
            label: "Expected guests",
            value:
              values.expectedGuests === undefined ||
              values.expectedGuests === null
                ? "—"
                : String(values.expectedGuests),
          },
        ]}
      />

      <ReviewGroup
        title="Date & time"
        onEdit={() => onEdit(1)}
        rows={[
          ...(values.periods ?? []).map((range, index) => ({
            label:
              (values.periods ?? []).length > 1
                ? `Event range ${index + 1}`
                : "Event",
            value: formatRange(range),
          })),
          { label: "Timezone", value: values.timezone || "—" },
          { label: "Allow overlap", value: values.allowOverlap ? "Yes" : "No" },
          {
            label: "Registration",
            value: formatRange(values.registrationPeriod ?? {}),
          },
        ]}
      />

      <ReviewGroup
        title="Registration"
        onEdit={() => onEdit(2)}
        rows={[
          {
            label: "Form",
            value: (
              <span className="text-slate-500">
                Not linked yet — you can add one later
              </span>
            ),
          },
        ]}
      />

      <ReviewGroup
        title="Public page"
        onEdit={() => onEdit(3)}
        rows={[
          {
            label: "Mode",
            value: PAGE_MODE_LABELS[values.pageMode ?? "default"],
          },
          ...(values.pageMode === "redirect"
            ? [{ label: "URL", value: values.redirectUrl || "—" }]
            : []),
        ]}
      />

      <FormField
        control={form.control}
        name="status"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Publish status</FormLabel>
            <FormControl>
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="gap-3"
              >
                {[
                  {
                    value: "Draft" as const,
                    title: "Save as draft",
                    description: "Keep working on it — nothing goes live yet.",
                  },
                  {
                    value: "Published" as const,
                    title: "Publish now",
                    description:
                      "Make the event live and open for registration.",
                  },
                ].map((option) => {
                  const selected = field.value === option.value;
                  return (
                    <FormLabel
                      key={option.value}
                      htmlFor={`status-${option.value}`}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition",
                        selected
                          ? "border-orange-400 bg-orange-50"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300",
                      )}
                    >
                      <RadioGroupItem
                        id={`status-${option.value}`}
                        value={option.value}
                        className="mt-0.5"
                      />
                      <span className="space-y-1">
                        <span className="block text-sm font-semibold text-slate-950">
                          {option.title}
                        </span>
                        <span className="block text-xs leading-5 text-slate-600">
                          {option.description}
                        </span>
                      </span>
                    </FormLabel>
                  );
                })}
              </RadioGroup>
            </FormControl>
          </FormItem>
        )}
      />
    </div>
  );
}
