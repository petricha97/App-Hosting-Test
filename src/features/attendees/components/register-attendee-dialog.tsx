"use client";

// "+ Register attendee" dialog (M5-T2, design §1): path → ticket →
// registration type → personal fields, submitted to the manual-registration
// route which runs the SAME pipeline as public finalize (placeOrder →
// FormData → auto-accept → Attendee).
//
// - Card paths render as DISABLED select items with the "public flow"
//   tooltip (offline payments only — spec decision).
// - Ticket options are pre-filtered by the path's audience eligibility
//   (advisory; the server re-validates) and disabled when sold out.
// - Registration type resolves automatically when the path/ticket pin it
//   down (read-only summary line); a picker appears only when ambiguous.
// - Personal fields come from the event form's question fields — same RHF +
//   buildFormSubmissionSchema validation as the public step 1.
// - Server errors (SOLD_OUT, …) render as an inline role="alert" row and the
//   dialog stays open; success closes it, toasts and refreshes the roster.
// - requestId is minted ONCE per dialog open (crypto.randomUUID) so retries
//   and double-clicks collapse onto one order/submission/attendee.

import { useEffect, useMemo, useState } from "react";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  isManualRegistrationPath,
  isTicketEligibleForAudience,
  resolveRegistrationTypeChoice,
} from "@/features/attendees/utils";
import {
  buildFormSubmissionSchema,
  type FormFieldValues,
} from "@/features/form/schema";
import type { SerializedRegistrationPath } from "@/features/registration-paths/types";
import type {
  SerializedRegistrationType,
  SerializedTicketType,
} from "@/features/registration/types";

interface RegisterAttendeeDialogProps {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paths: SerializedRegistrationPath[];
  tickets: SerializedTicketType[];
  registrationTypes: SerializedRegistrationType[];
  questionFields: FormFieldValues[];
  // False when the event has no form yet — the route would 409, so the
  // dialog explains and disables submit instead.
  hasForm: boolean;
  onRegistered: () => void;
}

function isSoldOut(ticket: SerializedTicketType): boolean {
  return ticket.capacity !== null && ticket.registeredCount >= ticket.capacity;
}

function buildDefaults(fields: FormFieldValues[]): Record<string, string> {
  return fields.reduce<Record<string, string>>((accumulator, field) => {
    accumulator[field.key] = "";
    return accumulator;
  }, {});
}

export function RegisterAttendeeDialog({
  eventId,
  open,
  onOpenChange,
  paths,
  tickets,
  registrationTypes,
  questionFields,
  hasForm,
  onRegistered,
}: RegisterAttendeeDialogProps) {
  const [requestId, setRequestId] = useState<string>("");
  const [pathId, setPathId] = useState("");
  const [ticketTypeId, setTicketTypeId] = useState("");
  const [registrationTypeId, setRegistrationTypeId] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submissionSchema = useMemo(
    () => buildFormSubmissionSchema(questionFields),
    [questionFields],
  );
  const form = useForm<Record<string, string>>({
    resolver: zodResolver(submissionSchema) as never,
    defaultValues: useMemo(() => buildDefaults(questionFields), [questionFields]),
  });

  // Fresh idempotency seed + clean slate on every dialog OPEN — retries
  // within one open collapse onto one requestId (T2 AC-6).
  useEffect(() => {
    if (open) {
      setRequestId(crypto.randomUUID());
      setPathId("");
      setTicketTypeId("");
      setRegistrationTypeId("");
      setSelectionError(null);
      setServerError(null);
      form.reset(buildDefaults(questionFields));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedPath = paths.find((path) => path.id === pathId) ?? null;
  const eligibleTickets = selectedPath
    ? tickets.filter((ticket) =>
        isTicketEligibleForAudience(
          ticket.registrationTypeIds,
          selectedPath.audienceRegistrationTypeId,
        ),
      )
    : [];
  const selectedTicket =
    eligibleTickets.find((ticket) => ticket.id === ticketTypeId) ?? null;

  const typeNameById = useMemo(
    () => new Map(registrationTypes.map((type) => [type.id, type.name])),
    [registrationTypes],
  );

  const typeResolution =
    selectedPath && selectedTicket
      ? resolveRegistrationTypeChoice({
          audienceRegistrationTypeId: selectedPath.audienceRegistrationTypeId,
          ticketRegistrationTypeIds: selectedTicket.registrationTypeIds,
          eventRegistrationTypeIds: registrationTypes.map((type) => type.id),
        })
      : null;

  const sortedPaths = useMemo(
    () => [...paths].sort((a, b) => a.sortOrder - b.sortOrder),
    [paths],
  );

  const submit = form.handleSubmit(async (values) => {
    if (!selectedPath || !selectedTicket) {
      setSelectionError("Choose a registration path and a ticket first.");
      return;
    }
    if (typeResolution?.kind === "choice" && !registrationTypeId) {
      setSelectionError("Choose a registration type for this ticket.");
      return;
    }
    setSelectionError(null);
    setServerError(null);
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/attendees/register`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId,
            pathId: selectedPath.id,
            ticketTypeId: selectedTicket.id,
            registrationTypeId:
              typeResolution?.kind === "choice" ? registrationTypeId : null,
            submission: values,
          }),
        },
      );

      if (response.ok) {
        toast.success("Attendee registered");
        onOpenChange(false);
        onRegistered();
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      setServerError(
        typeof data?.error === "string"
          ? data.error
          : "Something went wrong — check the fields and try again.",
      );
    } catch {
      setServerError("Something went wrong — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Register attendee</DialogTitle>
          <DialogDescription>
            Runs the same checks as public registration — capacity, pricing
            and eligibility included.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <fieldset disabled={submitting} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="register-attendee-path">Registration path</Label>
                <Select
                  value={pathId}
                  onValueChange={(value) => {
                    setPathId(value);
                    setTicketTypeId("");
                    setRegistrationTypeId("");
                  }}
                >
                  <SelectTrigger
                    id="register-attendee-path"
                    className="w-full"
                    aria-label="Registration path"
                  >
                    <SelectValue placeholder="Choose a path" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedPaths.map((path) =>
                      isManualRegistrationPath(path.paymentMethod) ? (
                        <SelectItem key={path.id} value={path.id}>
                          {path.name}
                        </SelectItem>
                      ) : (
                        <Tooltip key={path.id}>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="block">
                              <SelectItem value={path.id} disabled>
                                {path.name}
                              </SelectItem>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Card payments go through the public flow
                          </TooltipContent>
                        </Tooltip>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Manual registration covers offline paths only — invoice,
                  comp or no payment.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="register-attendee-ticket">Ticket</Label>
                <Select
                  value={ticketTypeId}
                  onValueChange={(value) => {
                    setTicketTypeId(value);
                    setRegistrationTypeId("");
                  }}
                  disabled={!selectedPath}
                >
                  <SelectTrigger
                    id="register-attendee-ticket"
                    className="w-full"
                    aria-label="Ticket"
                  >
                    <SelectValue
                      placeholder={
                        selectedPath ? "Choose a ticket" : "Choose a path first"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleTickets.map((ticket) => (
                      <SelectItem
                        key={ticket.id}
                        value={ticket.id}
                        disabled={isSoldOut(ticket)}
                      >
                        {ticket.name}
                        {isSoldOut(ticket) ? " — Sold out" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {typeResolution?.kind === "choice" ? (
                <div className="space-y-2">
                  <Label htmlFor="register-attendee-type">
                    Registration type
                  </Label>
                  <Select
                    value={registrationTypeId}
                    onValueChange={setRegistrationTypeId}
                  >
                    <SelectTrigger
                      id="register-attendee-type"
                      className="w-full"
                      aria-label="Registration type"
                    >
                      <SelectValue placeholder="Choose a registration type" />
                    </SelectTrigger>
                    <SelectContent>
                      {typeResolution.optionIds.map((optionId) => (
                        <SelectItem key={optionId} value={optionId}>
                          {typeNameById.get(optionId) ?? optionId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {typeResolution?.kind === "resolved" ? (
                <p className="text-sm text-muted-foreground">
                  Registration type:{" "}
                  <span className="font-medium text-foreground">
                    {typeNameById.get(typeResolution.registrationTypeId) ??
                      typeResolution.registrationTypeId}
                  </span>
                </p>
              ) : null}

              {hasForm ? (
                questionFields.map((field) => (
                  <FormField
                    key={field.id}
                    control={form.control}
                    name={field.key}
                    render={({ field: formField }) => (
                      <FormItem>
                        <FormLabel>
                          {field.label}
                          {field.required ? (
                            <span aria-hidden="true" className="text-destructive">
                              *
                            </span>
                          ) : null}
                        </FormLabel>
                        <FormControl>
                          {field.type === "textarea" ? (
                            <Textarea
                              rows={field.rows ?? 4}
                              placeholder={field.placeholder || undefined}
                              {...formField}
                            />
                          ) : (
                            <Input
                              type={field.type === "email" ? "email" : "text"}
                              placeholder={field.placeholder || undefined}
                              {...formField}
                            />
                          )}
                        </FormControl>
                        {field.helpText ? (
                          <p className="text-xs text-muted-foreground">
                            {field.helpText}
                          </p>
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  This event has no registration form yet — publish one before
                  registering attendees manually.
                </p>
              )}
            </fieldset>

            {selectionError || serverError ? (
              <p role="alert" className="text-sm text-destructive">
                {selectionError ?? serverError}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !hasForm}>
                {submitting ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                Register attendee
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
