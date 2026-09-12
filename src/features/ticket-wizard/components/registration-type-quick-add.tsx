"use client";

// Inline registration types save immediately through the existing endpoint.
// This ticket's price stays in the wizard and is saved with the final ticket.
import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
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
import { applyApiFormError } from "@/features/registration/components/form-errors";
import { generateRegistrationCode } from "@/features/registration/generate-code";
import {
  buildRegistrationTypePayload,
  registrationTypeFormSchema,
} from "@/features/registration/schemas";
import {
  parsePriceInputToMinor,
  PRICE_MESSAGE,
  WIZARD_DEFAULT_CURRENCY,
} from "@/features/ticket-wizard/schemas";

const quickAddSchema = registrationTypeFormSchema.safeExtend({
  price: z
    .string()
    .refine((value) => parsePriceInputToMinor(value) !== null, PRICE_MESSAGE),
});
type QuickAddValues = z.infer<typeof quickAddSchema>;

interface CreatedRegistrationType {
  id: string;
  name: string;
  code: string;
  price: string;
  capacity: number | null;
}

interface RegistrationTypeQuickAddProps {
  eventId: string;
  onCreated: (registrationType: CreatedRegistrationType) => void;
  onCancel: () => void;
  onSavingChange: (saving: boolean) => void;
}

/** Creates a real audience immediately and returns its entered ticket price to the wizard. */
export function RegistrationTypeQuickAdd({
  eventId,
  onCreated,
  onCancel,
  onSavingChange,
}: RegistrationTypeQuickAddProps) {
  const [codeEdited, setCodeEdited] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const form = useForm<QuickAddValues>({
    resolver: zodResolver(quickAddSchema),
    defaultValues: {
      name: "",
      code: "GENERAL",
      limitCapacity: false,
      capacity: "",
      price: "",
    },
  });
  const { isSubmitting, errors } = form.formState;

  // Hidden advanced fields must be visible when either server or client validation fails.
  useEffect(() => {
    if (errors.code || errors.capacity) setAdvancedOpen(true);
  }, [errors.code, errors.capacity]);

  /** Persists the audience only, exposing API errors locally and retaining the draft on failure. */
  const onSubmit = async (values: QuickAddValues) => {
    const payload = buildRegistrationTypePayload(values);
    onSavingChange(true);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/registration-types`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        applyApiFormError(
          form,
          await response.json().catch(() => null),
          "Failed to create the registration type.",
        );
        return;
      }
      const data = (await response.json()) as { registrationTypeId: string };
      onCreated({
        id: data.registrationTypeId,
        name: payload.name,
        code: payload.code,
        capacity: payload.capacity,
        price: values.price,
      });
    } catch {
      applyApiFormError(form, null, "Failed to create the registration type.");
    } finally {
      onSavingChange(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4"
      >
        <h3 className="text-sm font-semibold">New registration type</h3>
        <fieldset disabled={isSubmitting} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Registration type name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. Student, Member, Delegate"
                    maxLength={80}
                    autoFocus
                    {...field}
                    onChange={(event) => {
                      field.onChange(event);
                      if (!codeEdited)
                        form.setValue(
                          "code",
                          generateRegistrationCode(
                            event.target.value,
                            "GENERAL",
                          ),
                          { shouldValidate: true },
                        );
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="price"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Price for this ticket ({WIZARD_DEFAULT_CURRENCY})
                </FormLabel>
                <FormControl>
                  <Input
                    inputMode="decimal"
                    placeholder="e.g. 80.00"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Enter 0 for free registration.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <details
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Advanced settings
            </summary>
            {advancedOpen ? (
              <div className="space-y-4 pt-4">
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Registration type code</FormLabel>
                      <FormControl>
                        <Input
                          className="font-mono"
                          maxLength={12}
                          {...field}
                          onChange={(event) => {
                            setCodeEdited(true);
                            field.onChange(event.target.value.toUpperCase());
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        Generated automatically. You can edit it.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="limitCapacity"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3">
                      <FormLabel>
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
                {form.watch("limitCapacity") ? (
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
                            placeholder="e.g. 300"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
              </div>
            ) : null}
          </details>
        </fieldset>
        <p className="text-xs text-muted-foreground">
          Adding saves this registration type immediately, even if you close the
          ticket setup.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            Add &amp; include
          </Button>
        </div>
      </form>
    </Form>
  );
}
