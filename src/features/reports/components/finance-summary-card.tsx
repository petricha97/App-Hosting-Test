// Finance summary card (design §2): single-currency layout (4 rows,
// divide-y) or multi-currency stacked sections (one Paid/Outstanding/Comped
// group per currency, eyebrow-labeled, sharing one "Discount codes used" row
// below every section — never repeated per currency). Its own loading
// skeleton, empty state (zero RegistrationPath docs — the card's ONLY true
// empty state), and error state (independent from the ticket-type card).
import { Fragment } from "react";
import { CircleDollarSign } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EntityEmptyState,
  EntityTableError,
} from "@/features/registration/components/entity-table-states";
import { formatMoney } from "@/features/pricing/utils";
import type {
  CurrencyFinanceSection,
  FinanceCardData,
} from "@/features/reports/types";

export interface FinanceSummaryCardProps {
  eventId: string;
  data: FinanceCardData | null;
  loadError: boolean;
  onRetry: () => void;
}

interface MoneyRowProps {
  label: string;
  value: string;
  valueClassName: string;
}

function MoneyRow({ label, value, valueClassName }: MoneyRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueClassName}>{value}</span>
    </div>
  );
}

// The three currency-scoped money rows, unwrapped (no divide-y container) so
// callers can compose them into either the single-currency all-in-one group
// or a per-currency section group (design §2).
function CurrencyMoneyRows({ section }: { section: CurrencyFinanceSection }) {
  return (
    <Fragment>
      <MoneyRow
        label="Paid (card)"
        value={formatMoney(section.paidMinor, section.currency)}
        valueClassName="font-semibold tabular-nums text-foreground"
      />
      <MoneyRow
        label="Outstanding (invoice)"
        value={formatMoney(section.outstandingMinor, section.currency)}
        valueClassName="font-semibold tabular-nums text-amber-600 dark:text-amber-400"
      />
      <MoneyRow
        label="Comped value"
        // formatMoney verbatim (never formatFeePrice) — a $0.00 comped value
        // is the correct, honest render here, not "Comp" text (spec §2 / design §2).
        value={formatMoney(section.compedMinor, section.currency)}
        valueClassName="tabular-nums text-foreground"
      />
    </Fragment>
  );
}

function DiscountCodesRow({ count }: { count: number }) {
  return (
    <MoneyRow
      label="Discount codes used"
      value={String(count)}
      valueClassName="tabular-nums text-foreground"
    />
  );
}

export function FinanceSummaryCard({
  eventId,
  data,
  loadError,
  onRetry,
}: FinanceSummaryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Finance — orders overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loadError ? (
          <EntityTableError entityLabel="finance data" onRetry={onRetry} />
        ) : data === null ? (
          <EntityEmptyState
            icon={CircleDollarSign}
            title="No pricing set up yet"
            description="Add registration paths and fees for this event to start tracking payments here."
            actionLabel="Go to Registration Paths"
            href={`/dashboard/events/${encodeURIComponent(eventId)}/registration-paths`}
          />
        ) : data.currencies.length === 1 ? (
          <div className="divide-y divide-border">
            <CurrencyMoneyRows section={data.currencies[0]} />
            <DiscountCodesRow count={data.discountCodesUsed} />
          </div>
        ) : (
          <div className="space-y-5">
            {data.currencies.map((section) => (
              <div key={section.currency} className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.currency}
                </p>
                <div className="divide-y divide-border">
                  <CurrencyMoneyRows section={section} />
                </div>
              </div>
            ))}
            <div className="border-t border-border pt-1.5">
              <DiscountCodesRow count={data.discountCodesUsed} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Route-level loading.tsx composes this (design §2): 4 generic key-value row
// skeletons, no currency-eyebrow skeleton (real currency count unknown pre-fetch).
export function FinanceSummaryCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Finance — orders overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-5 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
