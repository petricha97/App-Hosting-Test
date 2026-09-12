"use client";

// Create/edit dialog for registration types (M1-T1).
// RHF + Zod on the client; the API route re-validates with the shared payload
// schema and owns code uniqueness + capacity >= registeredCount.
import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { generateRegistrationCode } from "@/features/registration/generate-code";
import { applyApiFormError } from "@/features/registration/components/form-errors";
import {
  buildRegistrationTypePayload,
  registrationTypeFormSchema,
  type RegistrationTypeFormValues,
} from "@/features/registration/schemas";
import type { SerializedRegistrationType } from "@/features/registration/types";

interface RegistrationTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  // null = create mode; a value = edit mode.
  registrationType: SerializedRegistrationType | null;
  onSaved: () => void;
}

// Seeds an audience form from an existing type or new unlimited defaults.
function buildDefaultValues(
  registrationType: SerializedRegistrationType | null,
): RegistrationTypeFormValues {
  return {
    name: registrationType?.name ?? "",
    code: registrationType?.code ?? "",
    limitCapacity:
      registrationType?.capacity !== null &&
      registrationType?.capacity !== undefined,
    capacity:
      registrationType?.capacity !== null &&
      registrationType?.capacity !== undefined
        ? String(registrationType.capacity)
        : "",
  };
}

// Creates or edits an audience with optional identifiers and shared capacity.
export function RegistrationTypeDialog({
  open,
  onOpenChange,
  eventId,
  registrationType,
  onSaved,
}: RegistrationTypeDialogProps) {
  const isEdit = registrationType !== null;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const manualCode = useRef(false);

  const form = useForm<RegistrationTypeFormValues>({
    resolver: zodResolver(registrationTypeFormSchema),
    defaultValues: buildDefaultValues(registrationType),
  });

  // Re-seed the form whenever the dialog opens for a different row (or mode).
  useEffect(() => {
    if (open) {
      form.reset(buildDefaultValues(registrationType));
      manualCode.current = false;
      setAdvancedOpen(false);
    }
  }, [open, registrationType, form]);

  const limitCapacity = form.watch("limitCapacity");
  const { isSubmitting } = form.formState;

  // Saves validated audience details and reveals advanced server validation errors.
  const onSubmit = async (values: RegistrationTypeFormValues) => {
    const payload = buildRegistrationTypePayload(values);
    const url = isEdit
      ? `/api/dashboard/events/${encodeURIComponent(eventId)}/registration-types/${encodeURIComponent(registrationType.id)}`
      : `/api/dashboard/events/${encodeURIComponent(eventId)}/registration-types`;
    const fallbackMessage = isEdit
      ? "Failed to update the registration type."
      : "Failed to create the registration type.";

    // try/catch so a network failure (offline, timeout) surfaces as a toast
    // and the dialog stays open for a retry — never an unhandled rejection
    // (repo convention, see create-event-workspace.tsx).
    try {
      const response = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setAdvancedOpen(true);
        applyApiFormError(form, data, fallbackMessage);
        return;
      }

      toast.success(
        isEdit ? "Registration type updated" : "Registration type created",
      );
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(fallbackMessage, {
        description: "Check your connection and try again.",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit registration type" : "Create registration type"}
          </DialogTitle>
          <DialogDescription>
            Registration types describe who attends. Pricing, badges, emails and
            check-in rules all key off the type.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit, () => setAdvancedOpen(true))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Delegate GC Online"
                      maxLength={80}
                      {...field}
                      onChange={(event) => {
                        field.onChange(event);
                        if (!isEdit && !manualCode.current) {
                          form.setValue(
                            "code",
                            generateRegistrationCode(
                              event.target.value,
                              "TYPE",
                            ),
                          );
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="button"
              variant="ghost"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen(!advancedOpen)}
            >
              Advanced settings
            </Button>
            {advancedOpen ? (
              <div className="space-y-4 rounded-lg border border-border p-4">
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="GC-ONL"
                          className="font-mono"
                          maxLength={12}
                          {...field}
                          onChange={(event) => {
                            manualCode.current = true;
                            field.onChange(event.target.value.toUpperCase());
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        Generated from the name. You can customise it for
                        pricing and reports.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="limitCapacity"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between gap-2 rounded-lg border border-border p-3">
                      <FormLabel className="font-normal">
                        Limit this audience across all tickets
                      </FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          aria-label="Limit this audience across all tickets"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {limitCapacity ? (
                  <FormField
                    control={form.control}
                    name="capacity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Audience limit</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            placeholder="e.g. 200"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Audience limit: Unlimited
                  </p>
                )}
              </div>
            ) : null}

            {isEdit ? (
              <p className="text-sm text-muted-foreground">
                {registrationType.registeredCount} registered so far.
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                {isEdit ? "Save changes" : "Create type"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
