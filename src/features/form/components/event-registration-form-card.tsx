"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ClipboardCheck, Loader2 } from "lucide-react";
import {
  useForm,
  type ControllerRenderProps,
} from "react-hook-form";
import { toast } from "sonner";

import {
  buildFormSubmissionSchema,
  type FormFieldValues,
} from "@/features/form/schema";
import type { SerializedForm } from "@/features/form/utils";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function buildDefaultSubmissionValues(fields: FormFieldValues[]) {
  return fields.reduce<Record<string, string>>((accumulator, field) => {
    accumulator[field.key] = "";
    return accumulator;
  }, {});
}

function renderFieldInput(field: FormFieldValues, formField: {
  value: string;
  onChange: ControllerRenderProps<Record<string, string>, string>["onChange"];
  onBlur: ControllerRenderProps<Record<string, string>, string>["onBlur"];
  name: ControllerRenderProps<Record<string, string>, string>["name"];
  ref: ControllerRenderProps<Record<string, string>, string>["ref"];
}) {
  if (field.type === "textarea") {
    return (
      <Textarea
        rows={field.rows ?? 4}
        placeholder={field.placeholder || "Type your answer"}
        className="rounded-[1.5rem] border-slate-200 bg-slate-50"
        {...formField}
      />
    );
  }

  return (
    <Input
      type={field.type === "email" ? "email" : "text"}
      placeholder={field.placeholder || "Type your answer"}
      className="h-12 rounded-2xl border-slate-200 bg-slate-50"
      {...formField}
    />
  );
}

interface EventRegistrationFormCardProps {
  eventId: string;
  eventName: string;
  form: SerializedForm | null;
  submitEndpoint?: string;
  heading?: string;
  description?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  submitLabel?: string;
}

export function EventRegistrationFormCard({
  eventId,
  eventName,
  form,
  submitEndpoint = `/api/dashboard/events/${eventId}/form/submit`,
  heading,
  description,
  emptyTitle = "No custom form saved yet",
  emptyDescription = "Open the form builder first, save a draft, then come back here to test the participant flow and write a real response into `FormData`.",
  submitLabel = "Submit registration",
}: EventRegistrationFormCardProps) {
  const submissionSchema = useMemo(
    () => buildFormSubmissionSchema((form?.fields ?? []) as FormFieldValues[]),
    [form?.fields],
  );
  type SubmissionValues = Record<string, string>;

  const reactForm = useForm<SubmissionValues>({
    resolver: zodResolver(submissionSchema) as never,
    defaultValues: useMemo(
      () =>
        buildDefaultSubmissionValues((form?.fields ?? []) as FormFieldValues[]) as SubmissionValues,
      [form?.fields],
    ),
  });

  async function onSubmit(values: SubmissionValues) {
    try {
      const response = await fetch(submitEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ submission: values }),
      });

      const payload = (await response.json()) as {
        error?: string;
        submissionId?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to submit the form");
      }

      toast.success("Form response saved", {
        description:
          "The response has been written into FormData for this event.",
      });
      reactForm.reset(
        buildDefaultSubmissionValues((form?.fields ?? []) as FormFieldValues[]) as SubmissionValues,
      );
    } catch (error) {
      console.error(error);
      toast.error("Unable to submit the form", {
        description:
          error instanceof Error
            ? error.message
            : "Please check the form fields and try again.",
      });
    }
  }

  if (!form) {
    return (
      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
            Registration form
          </CardDescription>
          <CardTitle className="text-2xl text-slate-950">
            {emptyTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-0 text-sm leading-7 text-slate-600">
          {emptyDescription}
        </CardContent>
      </Card>
    );
  }

  const isSubmitting = reactForm.formState.isSubmitting;

  return (
    <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
      <CardHeader className="px-6 pt-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div>
            <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
              Registration form
            </CardDescription>
            <CardTitle className="mt-2 text-2xl text-slate-950">
              {heading ?? `Test the participant flow for ${eventName}`}
            </CardTitle>
            <CardDescription className="mt-2 text-sm leading-7 text-slate-600">
              {description ??
                "This uses the saved custom form and writes a real submission into `FormData`."}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-6 pt-0">
        <Form {...reactForm}>
          <form onSubmit={reactForm.handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-slate-950">
                {form.title}
              </h3>
              <p className="text-sm leading-7 text-slate-600">
                Fill this out the same way a participant would. Required fields
                are enforced from the builder configuration.
              </p>
            </div>

            {form.fields.map((field) => (
              <FormField
                key={field.id}
                control={reactForm.control}
                name={field.key as keyof SubmissionValues}
                render={({ field: formField }) => (
                  <FormItem>
                    <FormLabel>
                      {field.label}
                      {field.required ? (
                        <span className="ml-1 text-orange-900">*</span>
                      ) : null}
                    </FormLabel>
                    <FormControl>
                      {renderFieldInput(field as FormFieldValues, formField)}
                    </FormControl>
                    {field.helpText ? (
                      <p className="text-sm leading-6 text-slate-500">
                        {field.helpText}
                      </p>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving response
                </>
              ) : (
                submitLabel
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
