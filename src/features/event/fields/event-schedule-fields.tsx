"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED FIELD GROUP — "Date & time"
// ─────────────────────────────────────────────────────────────────────────────
// Renders the scheduling inputs: the registration window, one-or-more event
// date ranges (`periods`, an add/remove list), the timezone, and the
// allow-overlap switch. SINGLE source of truth, rendered by BOTH screens:
//   • CREATE  → create-event-wizard.tsx  (Step 2, via step-schedule.tsx)
//   • EDIT    → create-event-workspace.tsx (the "Schedule and timing" card)
//
// NOTE: the event *status* (Draft/Published) is deliberately NOT here.
//   - CREATE puts the Draft/Publish choice on the Review step.
//   - EDIT renders its own status <select> right after this group.
// Owning the `periods` useFieldArray here means both screens get identical
// add/remove behaviour with zero duplication.
// ─────────────────────────────────────────────────────────────────────────────

import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, type UseFormReturn } from "react-hook-form";

import type { EventFormInput, EventFormValues } from "@/features/event/schema";
import { EMPTY_SCHEDULE_RANGE } from "@/features/event/event-form-core";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface EventScheduleFieldsProps {
  /** The shared react-hook-form instance from the parent screen. */
  form: UseFormReturn<EventFormInput, undefined, EventFormValues>;
  /** Today's date (YYYY-MM-DD) — used as the min for registration start. */
  todayDateString: string;
}

/** Renders the registration window, the add/remove list of event date ranges,
 *  the timezone and the allow-overlap switch. Owns the `periods` field array.
 *  Shared by the create wizard and the edit workspace. */
export function EventScheduleFields({
  form,
  todayDateString,
}: EventScheduleFieldsProps) {
  // The event can span multiple non-contiguous date ranges (e.g. Thu–Fri, then
  // Mon–Tue). This drives the "Add range" / "Remove" list below.
  const scheduleRanges = useFieldArray({
    control: form.control,
    name: "periods",
  });

  return (
    <div className="space-y-5">
      {/* ── Registration window ─────────────────────────────────────────── */}
      <div className="space-y-4 rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            Registration window
          </h3>
          <p className="text-sm leading-6 text-slate-600">
            Registration must open and close within a valid range, and it cannot
            start before today.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <FormField
            control={form.control}
            name="registrationPeriod.startDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Registration start date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    min={todayDateString}
                    className="h-12 rounded-2xl border-slate-200 bg-white"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="registrationPeriod.startTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Registration start time</FormLabel>
                <FormControl>
                  <Input
                    type="time"
                    className="h-12 rounded-2xl border-slate-200 bg-white"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <FormField
            control={form.control}
            name="registrationPeriod.endDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Registration end date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    // End can't be before the chosen start (falls back to today).
                    min={
                      form.watch("registrationPeriod.startDate") ||
                      todayDateString
                    }
                    className="h-12 rounded-2xl border-slate-200 bg-white"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="registrationPeriod.endTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Registration end time</FormLabel>
                <FormControl>
                  <Input
                    type="time"
                    className="h-12 rounded-2xl border-slate-200 bg-white"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>

      {/* ── Event date ranges (add/remove list, at least one required) ────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">
              Event date ranges
            </h3>
            <p className="text-sm leading-6 text-slate-600">
              Each range represents one continuous block of event time.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => scheduleRanges.append({ ...EMPTY_SCHEDULE_RANGE })}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add range
          </Button>
        </div>

        {scheduleRanges.fields.map((range, index) => (
          <div
            key={range.id}
            className="space-y-4 rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  Range {index + 1}
                </p>
                <p className="text-xs leading-6 text-slate-500">
                  Start and end are required for every schedule block.
                </p>
              </div>
              {/* The last remaining range can't be removed (schema requires ≥1). */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => scheduleRanges.remove(index)}
                disabled={scheduleRanges.fields.length === 1}
                title="Remove range"
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Remove range</span>
              </Button>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField
                control={form.control}
                name={`periods.${index}.startDate`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        className="h-12 rounded-2xl border-slate-200 bg-white"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`periods.${index}.startTime`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start time</FormLabel>
                    <FormControl>
                      <Input
                        type="time"
                        className="h-12 rounded-2xl border-slate-200 bg-white"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <FormField
                control={form.control}
                name={`periods.${index}.endDate`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        className="h-12 rounded-2xl border-slate-200 bg-white"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`periods.${index}.endTime`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End time</FormLabel>
                    <FormControl>
                      <Input
                        type="time"
                        className="h-12 rounded-2xl border-slate-200 bg-white"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        ))}
      </div>

      {/* ── Timezone ──────────────────────────────────────────────────────── */}
      <FormField
        control={form.control}
        name="timezone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Timezone</FormLabel>
            <FormControl>
              <Input
                placeholder="Asia/Singapore"
                className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                {...field}
              />
            </FormControl>
            <FormDescription>
              IANA timezone name, e.g. Asia/Singapore.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* ── Allow overlapping sessions ────────────────────────────────────── */}
      <FormField
        control={form.control}
        name="allowOverlap"
        render={({ field }) => (
          <FormItem className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4">
            <div className="space-y-1">
              <FormLabel>Allow overlapping sessions</FormLabel>
              <FormDescription>
                Let attendees register for sessions that run at the same time.
              </FormDescription>
            </div>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )}
      />
    </div>
  );
}
