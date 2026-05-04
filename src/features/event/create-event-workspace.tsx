"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { serverTimestamp } from "firebase/firestore";
import {
  CalendarClock,
  FileStack,
  Globe,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { createEvent } from "@/lib/db/event";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import {
  eventFormSchema,
  type EventFormInput,
  type EventScheduleRangeValues,
  type EventFormValues,
} from "@/features/event/schema";
import { buildOrganizationEventPath } from "@/features/event/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const FORM_ID = "create-event-form";

const EMPTY_SCHEDULE_RANGE: EventScheduleRangeValues = {
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
};

const PENDING_FORM_PATH = "Form/pending";

function buildOrganizationPath(organizationId: string | null) {
  return organizationId ? buildOrganizationEventPath(organizationId) : "";
}

export function CreateEventWorkspace() {
  const router = useRouter();
  const { organization, organizationId, initializing } = useAuth();

  const organizationPathDefault = useMemo(
    () => buildOrganizationPath(organizationId),
    [organizationId],
  );

  const form = useForm<EventFormInput, undefined, EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: {
      name: "",
      description: "",
      capacity: 1,
      expectedGuests: 0,
      formPath: PENDING_FORM_PATH,
      invoicePath: "",
      organizationPath: organizationPathDefault,
      timezone: "Asia/Singapore",
      allowOverlap: false,
      status: "Draft",
      periods: [{ ...EMPTY_SCHEDULE_RANGE }],
    },
  });
  const scheduleRanges = useFieldArray({
    control: form.control,
    name: "periods",
  });

  useEffect(() => {
    const currentPath = form.getValues("organizationPath");
    const isUntouched = !form.getFieldState("organizationPath").isDirty;

    if (organizationPathDefault && (!currentPath || isUntouched)) {
      form.setValue("organizationPath", organizationPathDefault, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [form, organizationPathDefault]);

  useEffect(() => {
    const currentFormPath = form.getValues("formPath");

    if (currentFormPath !== PENDING_FORM_PATH) {
      form.setValue("formPath", PENDING_FORM_PATH, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [form]);

  async function onSubmit(values: EventFormValues) {
    try {
      const id = await createEvent({
        ...values,
        createdAt: serverTimestamp() as never,
        updatedAt: serverTimestamp() as never,
        periods: values.periods,
      });

      toast.success("Draft event created", {
        description: "The event has been saved. Opening the event workspace now.",
      });

      router.push(`/dashboard/events/${id}`);
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("Failed to create event", {
        description: "Please review the fields and try again.",
      });
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Create event"
        title="Create a real draft event from the new dashboard workspace."
        description="This route now saves to Firestore using the existing event helper, while keeping the calmer dashboard-first layout we already scaffolded."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/dashboard/events">Back to Events</Link>
            </Button>
            <Button type="submit" form={FORM_ID} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving draft
                </>
              ) : (
                "Save draft"
              )}
            </Button>
          </>
        }
      />

      <section className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <Form {...form}>
          <form
            id={FORM_ID}
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6"
          >
            <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
              <CardHeader className="px-6 pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl text-slate-950">
                      Event basics
                    </CardTitle>
                    <CardDescription className="mt-2 text-sm leading-7 text-slate-600">
                      Start with the essential event details before moving into
                      form design and responses.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 px-6 pb-6 pt-0">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Event name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Tech Meetup 2026"
                          className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Describe the event"
                          className="min-h-32 rounded-[1.5rem] border-slate-200 bg-slate-50"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-5 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="capacity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Capacity</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            value={
                              field.value === undefined ? "" : String(field.value)
                            }
                            onChange={(event) => field.onChange(event.target.value)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="expectedGuests"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Expected guests</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            value={
                              field.value === undefined ? "" : String(field.value)
                            }
                            onChange={(event) => field.onChange(event.target.value)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
              <CardHeader className="px-6 pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl text-slate-950">
                      Schedule and timing
                    </CardTitle>
                    <CardDescription className="mt-2 text-sm leading-7 text-slate-600">
                      Add one or more date and time ranges. This supports
                      schedules like Thursday and Friday, skipping the weekend,
                      then continuing on Monday and Tuesday.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 px-6 pb-6 pt-0">
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

                <div className="grid gap-5 md:grid-cols-2">
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
                        Example: Asia/Singapore
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <FormControl>
                          <select
                            className="flex h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm shadow-sm outline-none transition focus:border-orange-300"
                            value={field.value}
                            onChange={field.onChange}
                          >
                            <option value="Draft">Draft</option>
                            <option value="Published">Published</option>
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="allowOverlap"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4">
                      <div className="space-y-1">
                        <FormLabel>Allow overlap</FormLabel>
                        <FormDescription>
                          Useful when separate schedule ranges might collide with
                          each other or with shared venue usage rules.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
              <CardHeader className="px-6 pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                    <FileStack className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <CardTitle className="text-2xl text-slate-950">
                        Registration and billing paths
                      </CardTitle>
                      <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-900">
                        Dev only
                      </span>
                    </div>
                    <CardDescription className="mt-2 text-sm leading-7 text-slate-600">
                      These legacy linkage values still exist in the event
                      document for development compatibility. They should be
                      removed once the model is cleaned up.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 px-6 pb-6 pt-0">
                <FormField
                  control={form.control}
                  name="formPath"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Form path</FormLabel>
                      <FormControl>
                        <Input
                          className="h-12 rounded-2xl border-slate-200 bg-slate-100 text-slate-600"
                          readOnly
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        This stays system-managed for now. It will be replaced
                        with the real `Form/&lt;id&gt;` link after the builder
                        saves its first draft.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="organizationPath"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Organization path</FormLabel>
                      <FormControl>
                        <Input
                          className="h-12 rounded-2xl border-slate-200 bg-slate-100 text-slate-600"
                          readOnly
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        This is filled from the active workspace and cannot be edited here.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </form>
        </Form>

        <div className="space-y-6">
          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
                    Workspace context
                  </CardDescription>
                  <CardTitle className="mt-2 text-2xl text-slate-950">
                    Save into the current organization
                  </CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0 text-sm leading-7 text-slate-600">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4">
                <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Active workspace
                </span>
                <p className="mt-2 text-base font-semibold text-slate-950">
                  {organization?.name ??
                    (initializing ? "Loading workspace..." : "No workspace found")}
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4">
                <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Organization path
                </span>
                <p className="mt-2 break-all text-sm text-slate-700">
                  {form.watch("organizationPath") || "Not set yet"}
                </p>
              </div>

              <p>
                The event is saved with empty periods and timestamp fields, then
                routed into its dedicated event workspace for the next setup step.
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-slate-950 py-0 text-white shadow-[0_24px_60px_-42px_rgba(15,23,42,0.55)]">
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-2xl">What happens next</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0 text-sm leading-7 text-slate-200">
              <p>
                After save, we take the user straight into the event overview so
                the next steps can become form design, responses, or publishing.
              </p>
              <Button
                type="submit"
                form={FORM_ID}
                disabled={isSubmitting}
                className="rounded-full bg-white text-slate-950 hover:bg-orange-50"
              >
                {isSubmitting ? "Saving..." : "Create event now"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
