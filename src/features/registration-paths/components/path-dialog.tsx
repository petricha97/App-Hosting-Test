"use client";

// Create/edit dialog for registration paths (M3-T1).
// RHF + Zod on the client; the API route re-validates with the shared payload
// schema and owns code uniqueness (409 field pointer) + audience membership.
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
  ANY_AUDIENCE,
  PATH_NAME_MAX,
  buildRegistrationPathPayload,
  registrationPathFormSchema,
  type RegistrationPathFormValues,
} from "@/features/registration-paths/schemas";
import type { SerializedRegistrationPath } from "@/features/registration-paths/types";
import {
  PAYMENT_METHOD_LABELS,
  isPaymentSkipped,
} from "@/features/registration-paths/utils";
import { applyApiFormError } from "@/features/registration/components/form-errors";
import type { SerializedRegistrationType } from "@/features/registration/types";
import { SUPPORTED_CURRENCIES } from "@/types/collection";

interface PathDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  // null = create mode; a value = edit mode.
  path: SerializedRegistrationPath | null;
  registrationTypes: SerializedRegistrationType[];
  // Prefilled sortOrder for create mode (max+1 within the event, T1).
  nextSortOrder: number;
  onSaved: () => void;
}

const PAYMENT_METHOD_OPTIONS = [
  { value: "card", label: "Card" },
  { value: "invoice", label: "Invoice" },
  { value: "comp", label: "Comp — free with confirmation" },
  { value: "none", label: "None — free" },
] as const;

function buildDefaultValues(
  path: SerializedRegistrationPath | null,
  nextSortOrder: number,
): RegistrationPathFormValues {
  return {
    name: path?.name ?? "",
    code: path?.code ?? "",
    audienceRegistrationTypeId: path?.audienceRegistrationTypeId ?? ANY_AUDIENCE,
    paymentMethod: path?.paymentMethod ?? "card",
    currency: path?.currency ?? "USD",
    sortOrder: String(path?.sortOrder ?? nextSortOrder),
    isActive: path?.isActive ?? true,
  };
}

export function PathDialog({
  open,
  onOpenChange,
  eventId,
  path,
  registrationTypes,
  nextSortOrder,
  onSaved,
}: PathDialogProps) {
  const isEdit = path !== null;

  const form = useForm<RegistrationPathFormValues>({
    resolver: zodResolver(registrationPathFormSchema),
    defaultValues: buildDefaultValues(path, nextSortOrder),
  });

  // Re-seed the form whenever the dialog opens for a different row (or mode).
  useEffect(() => {
    if (open) {
      form.reset(buildDefaultValues(path, nextSortOrder));
    }
  }, [open, path, nextSortOrder, form]);

  const { isSubmitting } = form.formState;
  const paymentMethod = form.watch("paymentMethod");

  const onSubmit = async (values: RegistrationPathFormValues) => {
    const payload = buildRegistrationPathPayload(values);
    const url = isEdit
      ? `/api/dashboard/events/${encodeURIComponent(eventId)}/registration-paths/${encodeURIComponent(path.id)}`
      : `/api/dashboard/events/${encodeURIComponent(eventId)}/registration-paths`;
    const fallbackMessage = isEdit
      ? "Failed to update the registration path."
      : "Failed to create the registration path.";

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

      toast.success(
        isEdit ? "Registration path updated" : "Registration path created",
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit registration path" : "Create registration path"}
          </DialogTitle>
          <DialogDescription>
            A path is the flow a registrant walks through — one per audience
            and payment method. The path also pins the checkout currency.
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
                      placeholder="e.g. 2.1 Sponsor — Invoice"
                      maxLength={PATH_NAME_MAX}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Tip: prefix with the flow number shown to your team — e.g.
                    2.1 Sponsor — Invoice
                  </FormDescription>
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
                      placeholder="SPN-CC"
                      className="font-mono"
                      maxLength={12}
                      {...field}
                      onChange={(event) =>
                        field.onChange(event.target.value.toUpperCase())
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    Short unique code used in reports, e.g. SPN-CC.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="audienceRegistrationTypeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Audience</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={ANY_AUDIENCE}>
                        Any registration type
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
                    Who this path is for. The same audience paying by card and
                    by invoice = two paths.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="paymentMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment method</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYMENT_METHOD_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
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
            </div>

            {isPaymentSkipped(paymentMethod) ? (
              <p className="text-sm text-muted-foreground">
                The Payment step is skipped for this path.
              </p>
            ) : null}

            <FormField
              control={form.control}
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sort order</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      className="tabular-nums"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Lower numbers appear first — you can also reorder from the
                    table.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                    Inactive paths never appear on the public picker but stay
                    listed here.
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
                {isEdit ? "Save changes" : "Create path"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
