"use client";

// Step 1 — Personal Information (design §3): renders the published form's
// QUESTION fields (commerce fields excluded) with the same RHF +
// buildFormSubmissionSchema validation as the flat form. The parent owns the
// draft POST/PATCH; this component only produces validated answers.

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";

import {
  buildDefaultSubmissionValues,
  renderFieldInput,
} from "@/features/form/components/event-registration-form-card";
import {
  buildFormSubmissionSchema,
  type FormFieldValues,
} from "@/features/form/schema";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

interface PersonalInfoStepProps {
  fields: FormFieldValues[];
  initialValues: Record<string, string>;
  submitting: boolean;
  onComplete: (values: Record<string, string>) => Promise<void>;
}

export function PersonalInfoStep({
  fields,
  initialValues,
  submitting,
  onComplete,
}: PersonalInfoStepProps) {
  const submissionSchema = useMemo(
    () => buildFormSubmissionSchema(fields),
    [fields],
  );

  const form = useForm<Record<string, string>>({
    resolver: zodResolver(submissionSchema) as never,
    defaultValues: useMemo(
      () => ({ ...buildDefaultSubmissionValues(fields), ...initialValues }),
      [fields, initialValues],
    ),
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => onComplete(values))}
        className="space-y-5"
      >
        {fields.map((field) => (
          <FormField
            key={field.id}
            control={form.control}
            name={field.key}
            render={({ field: formField }) => (
              <FormItem>
                <FormLabel>
                  {field.label}
                  {field.required ? (
                    <span className="ml-1 text-orange-900">*</span>
                  ) : null}
                </FormLabel>
                <FormControl>{renderFieldInput(field, formField)}</FormControl>
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

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Continue"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
