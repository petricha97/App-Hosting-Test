"use client";

// Trigger fields for the compose editor (design §3): system definitions show
// a locked trigger type (editable datetime only when the system trigger is
// "scheduled"); custom definitions get the Manual/Scheduled select plus a
// datetime field when Scheduled is chosen. Split out of
// email-editor-dialog.tsx (S-1, M6-T2 code review) — pure extraction, no
// behavior change.
import type { UseFormReturn } from "react-hook-form";

import {
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
import { EmailEditorLockedRow } from "@/features/emails/components/email-editor-locked-row";
import type { EmailEditorFormValues } from "@/features/emails/schemas";
import type { SerializedEmailDefinitionTrigger } from "@/features/emails/types";
import { triggerDisplayLabel } from "@/features/emails/utils";

interface EmailEditorTriggerFieldsProps {
  isSystem: boolean;
  definitionTrigger: SerializedEmailDefinitionTrigger | null;
  timeZone: string;
  triggerType: "manual" | "scheduled";
  form: UseFormReturn<EmailEditorFormValues>;
}

export function EmailEditorTriggerFields({
  isSystem,
  definitionTrigger,
  timeZone,
  triggerType,
  form,
}: EmailEditorTriggerFieldsProps) {
  if (isSystem) {
    if (definitionTrigger?.type === "scheduled") {
      return (
        <FormField
          control={form.control}
          name="scheduledAt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Send at (event time zone)</FormLabel>
              <FormControl>
                <Input
                  type="datetime-local"
                  placeholder="No date set"
                  {...field}
                />
              </FormControl>
              <FormDescription>Times use {timeZone}.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      );
    }
    return (
      <EmailEditorLockedRow
        label="Trigger"
        value={triggerDisplayLabel(
          definitionTrigger ?? { type: "manual" },
          timeZone,
        )}
      />
    );
  }

  return (
    <>
      <FormField
        control={form.control}
        name="triggerType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Trigger</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      {triggerType === "scheduled" ? (
        <FormField
          control={form.control}
          name="scheduledAt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Send at (event time zone)</FormLabel>
              <FormControl>
                <Input type="datetime-local" {...field} />
              </FormControl>
              <FormDescription>Times use {timeZone}.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </>
  );
}
