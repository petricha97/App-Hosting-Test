"use client";

// Create/edit dialog for taxes (M2-T3). Percentage rates are entered as
// decimals with up to 3 places (8.875) and converted once to integer
// milli-percent (8875); fixed amounts are major units converted to integer
// minor units in a chosen currency. Exactly one type-specific group is sent.
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
  buildTaxPayload,
  formatMilliPercentAsRateInput,
  formatMinorAsPriceInput,
  taxFormSchema,
  type TaxFormValues,
} from "@/features/pricing/schemas";
import type { SerializedTax } from "@/features/pricing/types";
import { CURRENCY_SYMBOLS } from "@/features/pricing/utils";
import { applyApiFormError } from "@/features/registration/components/form-errors";
import { SUPPORTED_CURRENCIES } from "@/types/collection";

interface TaxDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  // null = create mode; a value = edit mode.
  tax: SerializedTax | null;
  onSaved: () => void;
}

function buildDefaultValues(tax: SerializedTax | null): TaxFormValues {
  return {
    name: tax?.name ?? "",
    code: tax?.code ?? "",
    type: tax?.type ?? "percentage",
    rate:
      tax?.rateMilliPercent != null
        ? formatMilliPercentAsRateInput(tax.rateMilliPercent)
        : "",
    fixedAmount:
      tax?.fixedAmountMinor != null
        ? formatMinorAsPriceInput(tax.fixedAmountMinor)
        : "",
    fixedCurrency: tax?.fixedCurrency ?? "USD",
    isActive: tax?.isActive ?? true,
  };
}

export function TaxDialog({
  open,
  onOpenChange,
  eventId,
  tax,
  onSaved,
}: TaxDialogProps) {
  const isEdit = tax !== null;

  const form = useForm<TaxFormValues>({
    resolver: zodResolver(taxFormSchema),
    defaultValues: buildDefaultValues(tax),
  });

  useEffect(() => {
    if (open) {
      form.reset(buildDefaultValues(tax));
    }
  }, [open, tax, form]);

  const { isSubmitting } = form.formState;
  const type = form.watch("type");
  const fixedCurrency = form.watch("fixedCurrency");

  const onSubmit = async (values: TaxFormValues) => {
    const payload = buildTaxPayload(values);
    const url = isEdit
      ? `/api/dashboard/events/${encodeURIComponent(eventId)}/pricing/taxes/${encodeURIComponent(tax.id)}`
      : `/api/dashboard/events/${encodeURIComponent(eventId)}/pricing/taxes`;
    const fallbackMessage = isEdit
      ? "Failed to update the tax."
      : "Failed to create the tax.";

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

      toast.success(isEdit ? "Tax updated" : "Tax created");
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit tax" : "Create tax"}</DialogTitle>
          <DialogDescription>
            Active taxes apply to every order&apos;s post-discount amount.
            Fixed-amount taxes only apply to orders in their currency.
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
                      placeholder="e.g. UK VAT"
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
                      placeholder="VAT-UK"
                      className="font-mono"
                      maxLength={12}
                      {...field}
                      onChange={(event) =>
                        field.onChange(event.target.value.toUpperCase())
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    Short unique code shown on order lines, e.g. TAX-NY.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage</SelectItem>
                      <SelectItem value="fixed">Fixed amount</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {type === "percentage" ? (
              <FormField
                control={form.control}
                name="rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="8.875"
                          className="pr-8 tabular-nums"
                          {...field}
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                        >
                          %
                        </span>
                      </div>
                    </FormControl>
                    <FormDescription>
                      0–100, up to 3 decimals — stored exactly (8.875% is 8875
                      milli-percent, no rounding).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="fixedCurrency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
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
                  name="fixedAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                          >
                            {CURRENCY_SYMBOLS[fixedCurrency]}
                          </span>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="2.50"
                            className="pl-9 tabular-nums"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={form.control}
              name="isActive"
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
                    Inactive taxes never apply to any order.
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
                {isEdit ? "Save changes" : "Create tax"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
