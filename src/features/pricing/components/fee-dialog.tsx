"use client";

// Create/edit dialog for fees (M2-T1). Price is entered in MAJOR units
// (e.g. 750.00) and converted once to integer minor units by the payload
// builder — no floats cross the wire. A 409 duplicate-combination response
// surfaces as a field error on the Ticket select, never a toast-only.
import { useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ALL_REGISTRATION_TYPES,
  buildFeePayload,
  feeFormSchema,
  formatMinorAsPriceInput,
  type FeeFormValues,
} from "@/features/pricing/schemas";
import type { SerializedFee } from "@/features/pricing/types";
import { CURRENCY_SYMBOLS } from "@/features/pricing/utils";
import { applyApiFormError } from "@/features/registration/components/form-errors";
import type {
  SerializedRegistrationType,
  SerializedTicketType,
} from "@/features/registration/types";
import { SUPPORTED_CURRENCIES } from "@/types/collection";

interface FeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  // null = create mode; a value = edit mode.
  fee: SerializedFee | null;
  tickets: SerializedTicketType[];
  registrationTypes: SerializedRegistrationType[];
  onSaved: () => void;
}

function buildDefaultValues(fee: SerializedFee | null): FeeFormValues {
  return {
    name: fee?.name ?? "",
    ticketTypeId: fee?.ticketTypeId ?? "",
    registrationTypeId: fee?.registrationTypeId ?? ALL_REGISTRATION_TYPES,
    currency: fee?.currency ?? "USD",
    price: fee ? formatMinorAsPriceInput(fee.basePriceMinor) : "",
    active: fee ? fee.status === "active" : true,
  };
}

export function FeeDialog({
  open,
  onOpenChange,
  eventId,
  fee,
  tickets,
  registrationTypes,
  onSaved,
}: FeeDialogProps) {
  const isEdit = fee !== null;

  const form = useForm<FeeFormValues>({
    resolver: zodResolver(feeFormSchema),
    defaultValues: buildDefaultValues(fee),
  });

  useEffect(() => {
    if (open) {
      form.reset(buildDefaultValues(fee));
    }
  }, [open, fee, form]);

  const { isSubmitting } = form.formState;
  const currency = form.watch("currency");

  const onSubmit = async (values: FeeFormValues) => {
    const payload = buildFeePayload(values);
    const url = isEdit
      ? `/api/dashboard/events/${encodeURIComponent(eventId)}/pricing/fees/${encodeURIComponent(fee.id)}`
      : `/api/dashboard/events/${encodeURIComponent(eventId)}/pricing/fees`;
    const fallbackMessage = isEdit
      ? "Failed to update the fee."
      : "Failed to create the fee.";

    // try/catch so a network failure surfaces as a toast and the dialog stays
    // open for a retry — never an unhandled rejection (repo convention).
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

      toast.success(isEdit ? "Fee updated" : "Fee created");
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
          <DialogTitle>{isEdit ? "Edit fee" : "Create fee"}</DialogTitle>
          <DialogDescription>
            A fee attaches a price to a ticket — per registration type and
            currency. Discounts are scoped to a currency too: no conversion
            happens at checkout.
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
                      placeholder="e.g. GC Early Bird — Delegate (USD)"
                      maxLength={80}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Tip: mirror the ticket code and append{" "}
                    <span className="font-mono">/C</span> or{" "}
                    <span className="font-mono">/S</span> for comp fees.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="ticketTypeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ticket</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a ticket" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {tickets.map((ticket) => (
                        <SelectItem key={ticket.id} value={ticket.id}>
                          {ticket.name} — {ticket.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="registrationTypeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Registration type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={ALL_REGISTRATION_TYPES}>
                        All registration types
                      </SelectItem>
                      {registrationTypes.map((registrationType) => (
                        <SelectItem
                          key={registrationType.id}
                          value={registrationType.id}
                        >
                          {registrationType.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    A fee pinned to a specific type wins over the &ldquo;All
                    registration types&rdquo; fee for the same ticket and
                    currency.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SUPPORTED_CURRENCIES.map((code) => (
                          <SelectItem key={code} value={code}>
                            <span className="font-mono">{code}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Base price</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                        >
                          {CURRENCY_SYMBOLS[currency]}
                        </span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="750.00"
                          className="pl-9 tabular-nums"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormDescription>
                      Enter 750.00 — stored as 75000 minor units (cents/pence).
                      0 makes this a comp fee.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="rounded-lg border border-border p-3">
                  <div className="flex flex-row items-center justify-between gap-2">
                    <FormLabel className="font-normal">Active</FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        aria-label="Active"
                      />
                    </FormControl>
                  </div>
                  <FormDescription>
                    Archived fees stay listed but are never charged and never
                    block another fee for the same combination.
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
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                {isEdit ? "Save changes" : "Create fee"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
