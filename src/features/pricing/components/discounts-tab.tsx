"use client";

// Discounts tab (M2-T2): a READ-ONLY projection of the event's promotions
// (EventPromotion docs — one source of truth, managed on the event Overview)
// plus a small settings dialog that edits ONLY the M2-new fields (level,
// validity window, usage cap, active). Codes / amounts / conditions are
// managed in Promotions — the header link and per-row action jump there.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Settings2, Tag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DiscountSettingsDialog } from "@/features/pricing/components/discount-settings-dialog";
import type { SerializedDiscount } from "@/features/pricing/types";
import {
  formatDiscountAmount,
  formatUsageLabel,
  formatValidityLabel,
  isDiscountCurrentlyActive,
} from "@/features/pricing/utils";
import {
  EntityEmptyState,
  EntityTableError,
} from "@/features/registration/components/entity-table-states";
import { InfoNote } from "@/features/registration/components/info-note";

interface DiscountsTabProps {
  eventId: string;
  discounts: SerializedDiscount[];
  // Resolved event timezone for validity rendering.
  timeZone: string;
  loadError: boolean;
}

export function DiscountsTab({
  eventId,
  discounts,
  timeZone,
  loadError,
}: DiscountsTabProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<SerializedDiscount | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = () => router.refresh();
  const nowMs = Date.now();
  const promotionsHref = `/dashboard/events/${encodeURIComponent(eventId)}#promotions`;

  const openSettings = (discount: SerializedDiscount) => {
    setEditing(discount);
    setDialogOpen(true);
  };

  const validityTitle = (discount: SerializedDiscount) => {
    const parts = [
      discount.validityStartMs !== null
        ? `from ${new Date(discount.validityStartMs).toISOString()}`
        : null,
      discount.validityEndMs !== null
        ? `until ${new Date(discount.validityEndMs).toISOString()}`
        : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : undefined;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span aria-live="polite">
          <Badge variant="secondary" className="rounded-full tabular-nums">
            {discounts.length}{" "}
            {discounts.length === 1 ? "discount" : "discounts"}
          </Badge>
        </span>
        <Button variant="outline" asChild>
          <Link href={promotionsHref}>
            Manage codes &amp; rules in Promotions
            <ExternalLink aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <InfoNote>
        Codes ending <span className="font-mono">/C</span> are client comps,{" "}
        <span className="font-mono">/S</span> staff comps. Fixed-amount codes
        apply in the order&apos;s currency — no conversion.
      </InfoNote>

      {loadError ? (
        <EntityTableError entityLabel="discounts" onRetry={refresh} />
      ) : discounts.length === 0 ? (
        <EntityEmptyState
          icon={Tag}
          title="No discount codes attached"
          description="Attach a promotion template to this event to create discount codes. Templates are reusable across events."
          actionLabel="Manage promotions"
          onAction={() => router.push(promotionsHref)}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table aria-label="Discounts" className="min-w-[60rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-40">Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Amount / %</TableHead>
                  <TableHead>Valid</TableHead>
                  <TableHead>Used</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {discounts.map((discount) => {
                  const active = isDiscountCurrentlyActive(discount, nowMs);
                  const capExhausted =
                    discount.usageCap !== null &&
                    discount.usedCount >= discount.usageCap;
                  return (
                    <TableRow key={discount.id}>
                      <TableCell className="font-medium text-foreground">
                        {discount.name}
                      </TableCell>
                      <TableCell>
                        {discount.enablePromoCode && discount.promoCode ? (
                          <span className="font-mono text-xs">
                            {discount.promoCode}
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground">—</span>
                            <Badge
                              variant="secondary"
                              className="rounded-full"
                            >
                              Auto-apply
                            </Badge>
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-full">
                          {discount.level === "partner" ? "Partner" : "Event"}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDiscountAmount(
                          discount.discountType,
                          discount.discountValue,
                        )}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground"
                        title={validityTitle(discount)}
                      >
                        {formatValidityLabel(discount, { timeZone, nowMs })}
                      </TableCell>
                      <TableCell
                        className={
                          capExhausted
                            ? "tabular-nums text-amber-600 dark:text-amber-400"
                            : "tabular-nums"
                        }
                      >
                        {formatUsageLabel(
                          discount.usedCount,
                          discount.usageCap,
                        )}
                      </TableCell>
                      <TableCell>
                        {active ? (
                          <Badge className="rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                            Yes
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="rounded-full">
                            No
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Discount settings for ${discount.name}`}
                            onClick={() => openSettings(discount)}
                          >
                            <Settings2 aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Open ${discount.name} in Promotions`}
                            asChild
                          >
                            <Link href={promotionsHref}>
                              <ExternalLink aria-hidden="true" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <DiscountSettingsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        discount={editing}
        timeZone={timeZone}
        onSaved={refresh}
      />
    </div>
  );
}
