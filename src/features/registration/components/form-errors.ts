"use client";

// Maps API error payloads onto React Hook Form fields so server-side failures
// (duplicate code, capacity below registered count, Zod 400s) surface as
// field-level messages instead of toasts wherever possible.
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

export function applyApiFormError<TFieldValues extends FieldValues>(
  form: UseFormReturn<TFieldValues>,
  payload: unknown,
  fallbackMessage: string,
) {
  if (payload && typeof payload === "object") {
    const { error, field } = payload as { error?: unknown; field?: unknown };

    // Business errors carry a field pointer: { error, field } (e.g. 409 dup code).
    if (typeof field === "string" && typeof error === "string") {
      form.setError(field as Path<TFieldValues>, {
        type: "server",
        message: error,
      });
      return;
    }

    // Zod 400s carry a flattened error: { error: { fieldErrors, formErrors } }.
    if (error && typeof error === "object" && "fieldErrors" in error) {
      const fieldErrors = (
        error as { fieldErrors?: Record<string, string[] | undefined> }
      ).fieldErrors;
      let applied = false;
      for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
        if (messages && messages.length > 0) {
          form.setError(key as Path<TFieldValues>, {
            type: "server",
            message: messages[0],
          });
          applied = true;
        }
      }
      if (applied) {
        return;
      }
    }

    if (typeof error === "string") {
      toast.error(error);
      return;
    }
  }

  toast.error(fallbackMessage);
}
