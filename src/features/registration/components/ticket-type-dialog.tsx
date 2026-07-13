"use client";

// Create/edit dialog for ticket types / admission items (M1-T2).
// Sales dates are native date inputs holding event-local calendar dates; the
// API converts them to UTC instants in the event's timezone. Empty
// registration-type selection = unrestricted ("All registration types").
import { useEffect, useId } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { applyApiFormError } from "@/features/registration/components/form-errors";
import { InfoNote } from "@/features/registration/components/info-note";
import {
  buildTicketTypePayload,
  ticketTypeFormSchema,
  type TicketTypeFormValues,
} from "@/features/registration/schemas";
import type {
  SerializedRegistrationType,
  SerializedTicketType,
} from "@/features/registration/types";
import { utcToEventLocalDate } from "@/features/registration/utils";

interface TicketTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  // null = create mode; a value = edit mode.
  ticketType: SerializedTicketType | null;
  registrationTypes: SerializedRegistrationType[];
  // Resolved event timezone (used to prefill the date inputs on edit).
  timeZone: string;
  onSaved: () => void;
}

function buildDefaultValues(
  ticketType: SerializedTicketType | null,
  timeZone: string,
): TicketTypeFormValues {
  return {
    name: ticketType?.name ?? "",
    code: ticketType?.code ?? "",
    limitCapacity:
      ticketType?.capacity !== null && ticketType?.capacity !== undefined,
    capacity:
      ticketType?.capacity !== null && ticketType?.capacity !== undefined
        ? String(ticketType.capacity)
        : "",
    salesStart:
      ticketType?.salesStartMs != null
        ? utcToEventLocalDate(ticketType.salesStartMs, timeZone)
        : "",
    salesEnd:
      ticketType?.salesEndMs != null
        ? utcToEventLocalDate(ticketType.salesEndMs, timeZone)
        : "",
    isOpen: ticketType?.isOpen ?? true,
    registrationTypeIds: ticketType?.registrationTypeIds ?? [],
  };
}

export function TicketTypeDialog({
  open,
  onOpenChange,
  eventId,
  ticketType,
  registrationTypes,
  timeZone,
  onSaved,
}: TicketTypeDialogProps) {
  const isEdit = ticketType !== null;
  const hasRegistrationTypes = registrationTypes.length > 0;
  const groupLabelId = useId();

  const form = useForm<TicketTypeFormValues>({
    resolver: zodResolver(ticketTypeFormSchema),
    defaultValues: buildDefaultValues(ticketType, timeZone),
  });

  useEffect(() => {
    if (open) {
      form.reset(buildDefaultValues(ticketType, timeZone));
    }
  }, [open, ticketType, timeZone, form]);

  const limitCapacity = form.watch("limitCapacity");
  const { isSubmitting } = form.formState;

  const onSubmit = async (values: TicketTypeFormValues) => {
    const payload = buildTicketTypePayload(values);
    const url = isEdit
      ? `/api/dashboard/events/${encodeURIComponent(eventId)}/tickets/${encodeURIComponent(ticketType.id)}`
      : `/api/dashboard/events/${encodeURIComponent(eventId)}/tickets`;
    const fallbackMessage = isEdit
      ? "Failed to update the ticket type."
      : "Failed to create the ticket type.";

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
        applyApiFormError(form, data, fallbackMessage);
        return;
      }

      toast.success(isEdit ? "Ticket type updated" : "Ticket type created");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(fallbackMessage, {
        description: "Check your connection and try again.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit ticket type" : "Create ticket type"}
          </DialogTitle>
          <DialogDescription>
            Tickets are what attendees register as — each with its own code,
            capacity and sales window. Price is set in Pricing (M2).
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. GC Early Bird"
                      maxLength={80}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="GC-EB"
                      className="font-mono"
                      maxLength={12}
                      {...field}
                      onChange={(event) =>
                        field.onChange(event.target.value.toUpperCase())
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    Short unique code used in pricing and reports, e.g. GC-SEB.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {hasRegistrationTypes ? (
              <FormField
                control={form.control}
                name="registrationTypeIds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel id={groupLabelId}>
                      Who can buy this ticket
                    </FormLabel>
                    <div
                      role="group"
                      aria-labelledby={groupLabelId}
                      className="space-y-2 rounded-lg border border-border p-3"
                    >
                      {registrationTypes.map((registrationType) => {
                        const checkboxId = `${groupLabelId}-${registrationType.id}`;
                        const checked = field.value.includes(
                          registrationType.id,
                        );
                        return (
                          <div
                            key={registrationType.id}
                            className="flex items-center gap-2"
                          >
                            <Checkbox
                              id={checkboxId}
                              checked={checked}
                              onCheckedChange={(state) =>
                                field.onChange(
                                  state === true
                                    ? [...field.value, registrationType.id]
                                    : field.value.filter(
                                        (id) => id !== registrationType.id,
                                      ),
                                )
                              }
                            />
                            <Label
                              htmlFor={checkboxId}
                              className="flex items-center gap-2 font-normal"
                            >
                              <span>{registrationType.name}</span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {registrationType.code}
                              </span>
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                    <FormDescription>
                      Leave all unchecked to make this ticket available to
                      every registration type (&ldquo;All registration
                      types&rdquo;).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <InfoNote>
                <b>Create a registration type first.</b> Tickets are offered to
                registration types — define who attends on the{" "}
                <Link
                  href={`/dashboard/events/${encodeURIComponent(eventId)}/registration-types`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Registration Types
                </Link>{" "}
                screen, then come back here.
              </InfoNote>
            )}

            <FormField
              control={form.control}
              name="limitCapacity"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-2 rounded-lg border border-border p-3">
                  <FormLabel className="font-normal">Limit capacity</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      aria-label="Limit capacity"
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
                    <FormLabel>Capacity</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        placeholder="e.g. 150"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Capacity: Unlimited
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="salesStart"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sales open</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="salesEnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sales close</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Leave both empty to keep the ticket always open. Times use the
              event timezone (open at 00:00, close at 23:59).
            </p>

            <FormField
              control={form.control}
              name="isOpen"
              render={({ field }) => (
                <FormItem className="rounded-lg border border-border p-3">
                  <div className="flex flex-row items-center justify-between gap-2">
                    <FormLabel className="font-normal">
                      Available for registration
                    </FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        aria-label="Available for registration"
                      />
                    </FormControl>
                  </div>
                  <FormDescription>
                    Manual override — a closed sales window wins.
                  </FormDescription>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !hasRegistrationTypes}
              >
                {isSubmitting ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                {isEdit ? "Save changes" : "Create ticket type"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
