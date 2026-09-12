"use client";

// The creation form keeps quantity and scheduling upfront; generated codes live
// in Advanced settings. The wizard owns form and code-override state across steps.
import { useId } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { generateRegistrationCode } from "@/features/registration/generate-code";
import type { TicketWizardDetailsFormValues } from "@/features/ticket-wizard/schemas";

interface StepDetailsProps {
  form: UseFormReturn<TicketWizardDetailsFormValues>;
  codeEdited: boolean;
  onCodeEdited: () => void;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  timeZone: string;
}

/** Renders ticket details and reports manual code edits to the persistent wizard state. */
export function StepDetails({
  form,
  codeEdited,
  onCodeEdited,
  advancedOpen,
  onAdvancedOpenChange,
  timeZone,
}: StepDetailsProps) {
  const id = useId();
  const limitCapacity = form.watch("limitCapacity");
  const scheduleSales = form.watch("scheduleSales");

  return (
    <div className="space-y-5">
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Ticket name</FormLabel>
            <FormControl>
              <Input
                placeholder="e.g. Early Bird Pass"
                maxLength={80}
                {...field}
                onChange={(event) => {
                  field.onChange(event);
                  if (!codeEdited)
                    form.setValue(
                      "code",
                      generateRegistrationCode(event.target.value),
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
        name="limitCapacity"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Ticket quantity</FormLabel>
            <FormControl>
              <RadioGroup
                value={field.value ? "limited" : "unlimited"}
                onValueChange={(value) => field.onChange(value === "limited")}
                className="flex flex-wrap gap-3"
                aria-label="Ticket quantity"
              >
                <label
                  htmlFor={`${id}-unlimited`}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-3 has-[[data-state=checked]]:border-primary"
                >
                  <RadioGroupItem id={`${id}-unlimited`} value="unlimited" />{" "}
                  Unlimited
                </label>
                <label
                  htmlFor={`${id}-limited`}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-3 has-[[data-state=checked]]:border-primary"
                >
                  <RadioGroupItem id={`${id}-limited`} value="limited" /> Set
                  quantity
                </label>
              </RadioGroup>
            </FormControl>
            <FormDescription>
              Total available across all eligible audiences.
            </FormDescription>
          </FormItem>
        )}
      />
      {limitCapacity ? (
        <FormField
          control={form.control}
          name="capacity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Number of tickets</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="e.g. 100"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      <div className="space-y-4 border-y border-border py-4">
        <FormField
          control={form.control}
          name="scheduleSales"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between gap-3">
                <FormLabel>Schedule ticket sales</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label="Schedule ticket sales"
                  />
                </FormControl>
              </div>
              <FormDescription>
                {scheduleSales
                  ? `Optional dates · ${timeZone}. Sales open at 00:00 and close at 23:59.`
                  : "Sales start when you publish, with no end date."}
              </FormDescription>
            </FormItem>
          )}
        />
        {scheduleSales ? (
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
        ) : null}
      </div>

      <details
        open={advancedOpen}
        onToggle={(event) => onAdvancedOpenChange(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm text-muted-foreground">
          Advanced settings
        </summary>
        {advancedOpen ? (
          <div className="pt-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ticket code</FormLabel>
                  <FormControl>
                    <Input
                      className="font-mono"
                      maxLength={12}
                      {...field}
                      onChange={(event) => {
                        onCodeEdited();
                        field.onChange(event.target.value.toUpperCase());
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    Generated for you. Edit if you use your own codes for
                    pricing and reports.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        ) : null}
      </details>
    </div>
  );
}
