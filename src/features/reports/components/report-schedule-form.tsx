"use client";

// Create/edit form for a single M7-T3 report schedule (spec §1/§2/§3):
// template picker (create only — fixed once a schedule exists, D5), a
// Daily/Weekly/Monthly frequency selector with the matching conditional
// day field, an hour/minute time picker (event-local, no separate tz
// picker — spec §3), the recipients chip field, and an enabled toggle.
// Scalar fields are RHF-managed (src/features/reports/schedule-schemas.ts);
// templateSlug + recipients are plain component state so a per-recipient
// server rejection (D2) can be mapped back onto the exact chip that failed.
import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { InfoNote } from "@/features/registration/components/info-note";
import {
  type RecipientChip,
  ReportScheduleRecipientsField,
} from "@/features/reports/components/report-schedule-recipients-field";
import {
  reportScheduleFormSchema,
  type ReportScheduleFormValues,
} from "@/features/reports/schedule-schemas";
import { WEEKDAY_LABELS } from "@/features/reports/schedule-utils";
import {
  getReportTemplate,
  type ReportTemplateId,
} from "@/features/reports/templates";
import type {
  ReportScheduleRecipientError,
  SerializedReportSchedule,
} from "@/features/reports/types";

export interface ReportScheduleFormProps {
  eventId: string;
  timeZone: string;
  currentUserEmail: string;
  mode: "create" | "edit";
  // Fixed once a schedule exists (edit mode) — create mode offers a picker
  // limited to templates without a schedule yet.
  templateSlug: ReportTemplateId;
  availableTemplateSlugs: ReportTemplateId[];
  onTemplateSlugChange: (slug: ReportTemplateId) => void;
  existingSchedule: SerializedReportSchedule | null;
  onSaved: (schedule: SerializedReportSchedule) => void;
  onCancel: () => void;
}

function defaultFormValues(
  existing: SerializedReportSchedule | null,
): ReportScheduleFormValues {
  return {
    frequency: existing?.frequency ?? "daily",
    dayOfWeek: existing?.dayOfWeek ?? null,
    dayOfMonth: existing?.dayOfMonth ?? null,
    hour: existing?.hour ?? 9,
    minute: existing?.minute ?? 0,
    enabled: existing?.enabled ?? true,
  };
}

export function ReportScheduleForm({
  eventId,
  timeZone,
  currentUserEmail,
  mode,
  templateSlug,
  availableTemplateSlugs,
  onTemplateSlugChange,
  existingSchedule,
  onSaved,
  onCancel,
}: ReportScheduleFormProps) {
  const form = useForm<ReportScheduleFormValues>({
    resolver: zodResolver(reportScheduleFormSchema),
    defaultValues: defaultFormValues(existingSchedule),
  });

  const [recipients, setRecipients] = useState<RecipientChip[]>(
    existingSchedule?.recipients.map((r) => ({ email: r.email })) ?? [],
  );
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    form.reset(defaultFormValues(existingSchedule));
    setRecipients(
      existingSchedule?.recipients.map((r) => ({ email: r.email })) ?? [],
    );
    setRecipientsError(null);
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingSchedule]);

  const frequency = form.watch("frequency");

  const applyRecipientErrors = (errors: ReportScheduleRecipientError[]) => {
    const byEmail = new Map(errors.map((e) => [e.email, e.reason]));
    setRecipients((current) =>
      current.map((r) => ({ ...r, error: byEmail.get(r.email) })),
    );
  };

  const onSubmit = async (values: ReportScheduleFormValues) => {
    if (recipients.length === 0) {
      setRecipientsError("Add at least one recipient.");
      return;
    }
    setRecipientsError(null);
    setFormError(null);
    setSubmitting(true);

    try {
      const body = {
        ...values,
        recipientEmails: recipients.map((r) => r.email),
      };

      const url =
        mode === "create"
          ? `/api/dashboard/events/${encodeURIComponent(eventId)}/reports/schedules`
          : `/api/dashboard/events/${encodeURIComponent(eventId)}/reports/schedules/${templateSlug}`;
      const response = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "create" ? { ...body, templateSlug } : body,
        ),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 422 && Array.isArray(data?.recipientErrors)) {
          applyRecipientErrors(
            data.recipientErrors as ReportScheduleRecipientError[],
          );
          setFormError(
            typeof data?.error === "string"
              ? data.error
              : "One or more recipients could not be added.",
          );
          return;
        }
        setFormError(
          typeof data?.error === "string"
            ? data.error
            : "Failed to save the schedule.",
        );
        return;
      }

      onSaved(data.schedule as SerializedReportSchedule);
    } catch {
      setFormError(
        "Failed to save the schedule. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const templateOptions =
    mode === "create"
      ? availableTemplateSlugs
      : ([templateSlug] as ReportTemplateId[]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <FormLabel>Report</FormLabel>
          <Select
            value={templateSlug}
            onValueChange={(value) =>
              onTemplateSlugChange(value as ReportTemplateId)
            }
            disabled={mode === "edit"}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {templateOptions.map((slug) => (
                <SelectItem key={slug} value={slug}>
                  {getReportTemplate(slug)?.name ?? slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <FormField
          control={form.control}
          name="frequency"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Frequency</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  if (value !== "weekly") form.setValue("dayOfWeek", null);
                  if (value !== "monthly") form.setValue("dayOfMonth", null);
                  if (
                    value === "weekly" &&
                    form.getValues("dayOfWeek") === null
                  ) {
                    form.setValue("dayOfWeek", 1);
                  }
                  if (
                    value === "monthly" &&
                    form.getValues("dayOfMonth") === null
                  ) {
                    form.setValue("dayOfMonth", 1);
                  }
                }}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {frequency === "weekly" ? (
          <FormField
            control={form.control}
            name="dayOfWeek"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Day of week</FormLabel>
                <Select
                  value={String(field.value ?? 1)}
                  onValueChange={(value) => field.onChange(Number(value))}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {WEEKDAY_LABELS.map((label, index) => (
                      <SelectItem key={label} value={String(index)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        {frequency === "monthly" ? (
          <FormField
            control={form.control}
            name="dayOfMonth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Day of month</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={field.value ?? 1}
                    onChange={(event) =>
                      field.onChange(Number(event.target.value))
                    }
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground">
                  Fires on the last day of shorter months.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="hour"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Hour ({timeZone})</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={field.value}
                    onChange={(event) =>
                      field.onChange(Number(event.target.value))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="minute"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Minute</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={field.value}
                    onChange={(event) =>
                      field.onChange(Number(event.target.value))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-2">
          <FormLabel>Recipients</FormLabel>
          <ReportScheduleRecipientsField
            recipients={recipients}
            onChange={(next) => {
              setRecipients(next);
              setRecipientsError(null);
            }}
            currentUserEmail={currentUserEmail}
            disabled={submitting}
          />
          {recipientsError ? (
            <p className="text-sm text-destructive">{recipientsError}</p>
          ) : null}
        </div>

        <FormField
          control={form.control}
          name="enabled"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-3">
              <FormLabel className="mb-0">Enabled</FormLabel>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-label="Enabled"
                />
              </FormControl>
            </FormItem>
          )}
        />

        <InfoNote>
          The email contains a link back to this report — never row data,
          attendee names, or dollar amounts.
        </InfoNote>

        {formError ? (
          <p className="text-sm text-destructive" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            Save
          </Button>
        </div>
      </form>
    </Form>
  );
}
