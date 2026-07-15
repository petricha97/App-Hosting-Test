"use client";

// Sender settings dialog (design §6) — From name / From address / Reply-to,
// with a "Platform default" hint when no EmailSettings doc exists (viewing
// writes nothing). Default width (sm:max-w-lg) — a simple 3-field form.
import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InfoNote } from "@/features/registration/components/info-note";
import { applyApiFormError } from "@/features/registration/components/form-errors";
import {
  senderSettingsFormSchema,
  type SenderSettingsFormValues,
} from "@/features/emails/schemas";
import type { SerializedEmailSettings } from "@/features/emails/types";

interface SenderSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  settings: SerializedEmailSettings;
  onSaved: (settings: SerializedEmailSettings) => void;
}

export function SenderSettingsDialog({
  open,
  onOpenChange,
  eventId,
  settings,
  onSaved,
}: SenderSettingsDialogProps) {
  const [resetPending, setResetPending] = useState(false);

  const form = useForm<SenderSettingsFormValues>({
    resolver: zodResolver(senderSettingsFormSchema),
    defaultValues: {
      fromName: settings.fromName,
      fromAddress: settings.fromAddress,
      replyTo: settings.replyTo ?? "",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        fromName: settings.fromName,
        fromAddress: settings.fromAddress,
        replyTo: settings.replyTo ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings]);

  const onSubmit = async (values: SenderSettingsFormValues) => {
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/emails/settings`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        applyApiFormError(form, data, "Failed to save sender settings.");
        return;
      }

      toast.success("Sender settings saved");
      onSaved(data.settings as SerializedEmailSettings);
      onOpenChange(false);
    } catch {
      toast.error("Failed to save sender settings.", {
        description: "Check your connection and try again.",
      });
    }
  };

  const handleReset = async () => {
    setResetPending(true);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/emails/settings`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        toast.error("Failed to reset sender settings.");
        return;
      }
      const data = await response.json();
      toast.success("Cleared — showing platform defaults");
      onSaved(data.settings as SerializedEmailSettings);
    } catch {
      toast.error("Failed to reset sender settings.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setResetPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sender settings</DialogTitle>
          <DialogDescription>
            Who your event&apos;s emails appear to come from.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="fromName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    From name
                    {!settings.hasStoredDoc ? (
                      <Badge variant="secondary" className="text-[11px]">
                        Platform default
                      </Badge>
                    ) : null}
                  </FormLabel>
                  <FormControl>
                    <Input maxLength={100} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="fromAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    From address
                    {!settings.hasStoredDoc ? (
                      <Badge variant="secondary" className="text-[11px]">
                        Platform default
                      </Badge>
                    ) : null}
                  </FormLabel>
                  <FormControl>
                    <Input type="email" maxLength={254} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="replyTo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reply-to</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      maxLength={254}
                      placeholder="Same as from address"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {settings.hasStoredDoc ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                disabled={resetPending}
                onClick={handleReset}
              >
                {resetPending ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                Reset to platform default
              </Button>
            ) : null}

            <InfoNote>
              Emails aren&apos;t delivered in this environment yet — sends land
              in an internal log only. Using your own domain will require
              verification (SPF/DKIM) once real delivery ships.
            </InfoNote>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={form.formState.isSubmitting}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
