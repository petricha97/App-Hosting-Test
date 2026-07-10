"use client";

// Step 3 — Registration Summary (design §3): read-only step-1 answers +
// server-quoted line items. Every amount comes from the quote endpoint in
// minor units and is formatted here — never computed client-side (T3 AC-5).

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/features/pricing/utils";
import type { FormFieldValues } from "@/features/form/schema";
import type { PublicRegistrationQuote } from "@/features/public-registration/types";

interface SummaryStepProps {
  fields: FormFieldValues[];
  answers: Record<string, string>;
  ticketName: string | null;
  appliedPromoCode: string | null;
  quote: PublicRegistrationQuote | null;
  quoteError: string | null;
  onRetryQuote: () => void;
  onEditPersonalInfo: () => void;
}

export function SummaryStep({
  fields,
  answers,
  ticketName,
  appliedPromoCode,
  quote,
  quoteError,
  onRetryQuote,
  onEditPersonalInfo,
}: SummaryStepProps) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-950">Your details</h3>
          <Button
            type="button"
            variant="ghost"
            className="h-auto p-0 text-sm font-medium text-orange-900 hover:bg-transparent hover:underline"
            onClick={onEditPersonalInfo}
          >
            Edit
          </Button>
        </div>
        <dl className="space-y-2 text-sm">
          {fields.map((field) => (
            <div key={field.id} className="flex justify-between gap-4">
              <dt className="text-slate-500">{field.label}</dt>
              <dd className="text-right text-slate-950">
                {answers[field.key] || "—"}
              </dd>
            </div>
          ))}
          {ticketName ? (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Ticket</dt>
              <dd className="text-right text-slate-950">{ticketName}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="space-y-3 rounded-[1.5rem] border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-950">Order summary</h3>

        {quoteError ? (
          <div
            role="alert"
            className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          >
            <p>{quoteError}</p>
            <Button type="button" variant="outline" onClick={onRetryQuote}>
              Retry
            </Button>
          </div>
        ) : quote === null ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading totals">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between text-sm tabular-nums">
              <span className="text-slate-600">
                {ticketName ?? "Ticket"}
              </span>
              <span className="text-slate-950">
                {formatMoney(quote.subtotalMinor, quote.currency)}
              </span>
            </div>
            {quote.discountMinor > 0 ? (
              <div className="flex justify-between text-sm tabular-nums text-emerald-700">
                <span>
                  {appliedPromoCode ? `Promo ${appliedPromoCode}` : "Discount"}
                </span>
                <span>−{formatMoney(quote.discountMinor, quote.currency)}</span>
              </div>
            ) : null}
            {quote.taxLines.map((line) => (
              <div
                key={line.code}
                className="flex justify-between text-sm tabular-nums"
              >
                <span className="text-slate-600">{line.code}</span>
                <span className="text-slate-950">
                  {formatMoney(line.amountMinor, quote.currency)}
                </span>
              </div>
            ))}
            <Separator />
            <div className="flex justify-between text-base font-semibold tabular-nums">
              <span>Total</span>
              <span>
                {quote.totalMinor === 0
                  ? "Comp"
                  : formatMoney(quote.totalMinor, quote.currency)}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
