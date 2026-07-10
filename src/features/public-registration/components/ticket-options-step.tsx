"use client";

// Step 2 — Ticket & Options (design §3): radio-cards from the public tickets
// endpoint (server-filtered by eligibility × open × priced; sold-out shown
// disabled, never hidden), the "Register as" picker for ambiguous
// Any-audience tickets, and the promo-code apply flow. All prices are
// server-provided minor units — nothing is computed here; ambiguous tickets
// re-render their card price from the picked "Register as" option's
// server-resolved price (T2 AC-5, review S1).

import Link from "next/link";
import { Loader2, X } from "lucide-react";

import { formatFeePrice, formatMoney } from "@/features/pricing/utils";
import {
  registrationTypeOptionsHaveMixedPrices,
  ticketDisplayPrice,
} from "@/features/public-registration/ticket-price";
import type {
  CommerceFieldConfig,
  PublicTicketOption,
} from "@/features/public-registration/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";

export interface PromoState {
  input: string;
  appliedCode: string | null;
  discountMinor: number | null;
  error: string | null;
  applying: boolean;
}

interface TicketOptionsStepProps {
  eventId: string;
  tickets: PublicTicketOption[] | null;
  ticketsError: string | null;
  onRetryTickets: () => void;
  ticketField: CommerceFieldConfig;
  promoField: CommerceFieldConfig | null;
  selectedTicketId: string | null;
  selectedRegistrationTypeId: string | null;
  onSelectTicket: (ticketId: string) => void;
  onSelectRegistrationType: (registrationTypeId: string) => void;
  promo: PromoState;
  onPromoInputChange: (value: string) => void;
  onApplyPromo: () => void;
  onRemovePromo: () => void;
}

export function TicketOptionsStep({
  eventId,
  tickets,
  ticketsError,
  onRetryTickets,
  ticketField,
  promoField,
  selectedTicketId,
  selectedRegistrationTypeId,
  onSelectTicket,
  onSelectRegistrationType,
  promo,
  onPromoInputChange,
  onApplyPromo,
  onRemovePromo,
}: TicketOptionsStepProps) {
  const selectedTicket =
    tickets?.find((ticket) => ticket.id === selectedTicketId) ?? null;
  const registrationTypeOptions = selectedTicket?.registrationTypeOptions ?? null;

  if (ticketsError) {
    return (
      <div
        role="alert"
        className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
      >
        <p>{ticketsError}</p>
        <Button type="button" variant="outline" onClick={onRetryTickets}>
          Retry
        </Button>
      </div>
    );
  }

  if (tickets === null) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading tickets">
        <Skeleton className="h-20 w-full rounded-[1.5rem]" />
        <Skeleton className="h-20 w-full rounded-[1.5rem]" />
        <Skeleton className="h-20 w-full rounded-[1.5rem]" />
      </div>
    );
  }

  if (tickets.length === 0) {
    // Zero eligible tickets: designed empty state, progression blocked
    // (T2 AC-4) — the parent disables Continue when nothing is selectable.
    return (
      <div className="space-y-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-6 text-center">
        <p className="text-base font-semibold text-slate-950">
          No tickets available for this path
        </p>
        <p className="text-sm leading-6 text-slate-600">
          Tickets may open later, or a different registration path may fit you
          better.
        </p>
        <Link
          href={`/events/${eventId}/register`}
          className="inline-flex text-sm font-medium text-orange-900 underline-offset-4 hover:underline"
        >
          Choose a different registration path
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-950">
          {ticketField.label}
          <span className="ml-1 text-orange-900">*</span>
        </legend>
        {ticketField.helpText ? (
          <p className="text-sm leading-6 text-slate-500">
            {ticketField.helpText}
          </p>
        ) : null}

        <RadioGroup
          value={selectedTicketId ?? ""}
          onValueChange={onSelectTicket}
          className="space-y-3"
        >
          {tickets.map((ticket) => {
            const soldOut = ticket.availability === "sold_out";
            const isSelected = ticket.id === selectedTicketId;
            // Ambiguous tickets: exact price of the picked "Register as"
            // option once chosen; "From <min>" while prices vary (S1).
            const price = ticketDisplayPrice(
              ticket,
              selectedTicketId,
              selectedRegistrationTypeId,
            );

            return (
              <Label
                key={ticket.id}
                htmlFor={`ticket-${ticket.id}`}
                className={cn(
                  "flex cursor-pointer items-start justify-between gap-3 rounded-[1.5rem] border bg-white p-4 transition",
                  isSelected
                    ? "border-orange-400 ring-2 ring-orange-100"
                    : "border-slate-200 hover:border-slate-300",
                  soldOut && "cursor-not-allowed opacity-60",
                )}
              >
                <span className="flex items-start gap-3">
                  <RadioGroupItem
                    id={`ticket-${ticket.id}`}
                    value={ticket.id}
                    disabled={soldOut}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-950">
                      {ticket.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-xs text-slate-500">
                      {ticket.code}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {soldOut ? (
                    <Badge className="rounded-full bg-amber-100 text-amber-900 shadow-none">
                      Sold out
                    </Badge>
                  ) : null}
                  <span className="text-sm font-semibold tabular-nums text-slate-950">
                    {price.label}
                  </span>
                </span>
              </Label>
            );
          })}
        </RadioGroup>
      </fieldset>

      {/* "Register as" appears/disappears with the ticket choice — announced
          politely (design §3). */}
      <div aria-live="polite">
        {registrationTypeOptions && registrationTypeOptions.length > 0 ? (
          <div className="space-y-2">
            <Label htmlFor="register-as" className="text-sm font-semibold text-slate-950">
              Register as
              <span className="ml-1 text-orange-900">*</span>
            </Label>
            <select
              id="register-as"
              value={selectedRegistrationTypeId ?? ""}
              onChange={(event) => onSelectRegistrationType(event.target.value)}
              className="flex h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm shadow-sm outline-none transition focus:border-orange-300"
            >
              <option value="" disabled>
                Choose a registration type
              </option>
              {registrationTypeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {/* Prices in the labels only when they differ across
                      types — the pick drives the card price (S1). */}
                  {selectedTicket &&
                  registrationTypeOptionsHaveMixedPrices(selectedTicket)
                    ? `${option.name} — ${formatFeePrice(option.priceMinor, selectedTicket.currency)}`
                    : option.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {promoField ? (
        <div className="space-y-2">
          <Label htmlFor="promo-code" className="text-sm font-semibold text-slate-950">
            {promoField.label}
          </Label>
          {promo.appliedCode ? (
            <div className="flex items-center gap-2">
              <Badge className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900 shadow-none">
                {promo.appliedCode} applied
                {promo.discountMinor !== null && selectedTicket
                  ? ` — −${formatMoney(promo.discountMinor, selectedTicket.currency)}`
                  : ""}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full"
                onClick={onRemovePromo}
                aria-label="Remove code"
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  id="promo-code"
                  value={promo.input}
                  onChange={(event) => onPromoInputChange(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter applies the code — it never advances the step.
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onApplyPromo();
                    }
                  }}
                  placeholder={promoField.placeholder || "Enter a promo code"}
                  aria-invalid={promo.error ? true : undefined}
                  aria-describedby={promo.error ? "promo-code-error" : undefined}
                  className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={onApplyPromo}
                  disabled={promo.applying || promo.input.trim().length === 0}
                >
                  {promo.applying ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    "Apply"
                  )}
                </Button>
              </div>
              {promo.error ? (
                <p id="promo-code-error" className="text-sm text-red-600">
                  {promo.error}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
