"use client";

// Discount settings dialog (M2-T2): edits ONLY the six-field extension of an
// EventPromotion — level, validity window, usage cap, active. Name / code /
// amount / conditions keep their single editor on the Overview promotions
// screen; usedCount is server-owned and display-only here.
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
  buildDiscountSettingsPayload,
  discountSettingsFormSchema,
  type DiscountSettingsFormValues,
} from "@/features/pricing/schemas";
import type { SerializedDiscount } from "@/features/pricing/types";
import { applyApiFormError } from "@/features/registration/components/form-errors";
import { utcToEventLocalDate } from "@/features/registration/utils";

interface DiscountSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  discount: SerializedDiscount | null;
  // Resolved event timezone (prefills the date inputs).
  timeZone: string;
  onSaved: () => void;
}

function buildDefaultValues(
  discount: SerializedDiscount | null,
  timeZone: string,
): DiscountSettingsFormValues {
  return {
    level: discount?.level ?? "event",
    validityStart:
      discount?.validityStartMs != null
        ? utcToEventLocalDate(discount.validityStartMs, timeZone)
        : "",
    validityEnd:
      discount?.validityEndMs != null
        ? utcToEventLocalDate(discount.validityEndMs, timeZone)
        : "",
    limitUsage: discount?.usageCap != null,
    usageCap: discount?.usageCap != null ? String(discount.usageCap) : "",
    isActive: discount?.isActive ?? true,
  };
}

export function DiscountSettingsDialog({
  open,
  onOpenChange,
  eventId,
  discount,
  timeZone,
  onSaved,
}: DiscountSettingsDialogProps) {
  const form = useForm<DiscountSettingsFormValues>({
    resolver: zodResolver(discountSettingsFormSchema),
    defaultValues: buildDefaultValues(discount, timeZone),
  });

  useEffect(() => {
    if (open) {
      form.reset(buildDefaultValues(discount, timeZone));
    }
  }, [open, discount, timeZone, form]);

  const limitUsage = form.watch("limitUsage");
  const { isSubmitting } = form.formState;

  const onSubmit = async (values: DiscountSettingsFormValues) => {
    if (!discount) return;

    const payload = buildDiscountSettingsPayload(values);
    const fallbackMessage = "Failed to update the discount settings.";

    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/promotions/${encodeURIComponent(discount.id)}/settings`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        applyApiFormError(form, data, fallbackMessage);
        return;
      }

      toast.success("Discount settings updated");
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
          <DialogTitle>Discount settings</DialogTitle>
          <DialogDescription>
            {discount ? `${discount.name} — ` : ""}level, validity window,
            usage cap and active state. Codes and amounts are managed in
            Promotions.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="level"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Level</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="event">Event</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Partner codes are typically issued to sponsors or partner
                    organizations.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="validityStart"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valid from</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="validityEnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valid until</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Leave both empty for no window. Times use the event timezone
              (valid from 00:00, until 23:59).
            </p>

            <FormField
              control={form.control}
              name="limitUsage"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-2 rounded-lg border border-border p-3">
                  <FormLabel className="font-normal">Limit uses</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      aria-label="Limit uses"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {limitUsage ? (
              <FormField
                control={form.control}
                name="usageCap"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Usage cap</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        placeholder="e.g. 3"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Used {discount?.usedCount ?? 0}{" "}
                      {(discount?.usedCount ?? 0) === 1 ? "time" : "times"} so
                      far — the cap cannot go below that.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Uses: Unlimited (used {discount?.usedCount ?? 0} so far)
              </p>
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
                    Manual switch — an expired window or exhausted cap still
                    shows the code as inactive.
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
              <Button type="submit" disabled={isSubmitting || !discount}>
                {isSubmitting ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                Save settings
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
