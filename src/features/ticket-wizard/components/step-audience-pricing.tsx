"use client";

// Audience cards pair each selected registration type with its ticket price.
// The empty-event default remains a local draft until the organiser continues.
import { useEffect, useId, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { SerializedRegistrationType } from "@/features/registration/types";
import { RegistrationTypeQuickAdd } from "@/features/ticket-wizard/components/registration-type-quick-add";
import {
  WIZARD_DEFAULT_CURRENCY,
  type TicketWizardAudienceRow,
} from "@/features/ticket-wizard/schemas";

export interface DefaultAudienceLimit {
  limited: boolean;
  capacity: string;
}

interface StepAudiencePricingProps {
  eventId: string;
  rows: TicketWizardAudienceRow[];
  onRowsChange: (
    updater: (rows: TicketWizardAudienceRow[]) => TicketWizardAudienceRow[],
  ) => void;
  rowErrors: Record<string, string>;
  serverError: string | null;
  quickAddOpen: boolean;
  onQuickAddOpenChange: (open: boolean) => void;
  onQuickAddSavingChange: (saving: boolean) => void;
  onRegistrationTypeSaved: (audience: SerializedRegistrationType) => void;
  defaultLimit: DefaultAudienceLimit;
  onDefaultLimitChange: (limit: DefaultAudienceLimit) => void;
  busy: boolean;
}

/** Renders selectable audiences, immediate inline creation, and optional default-audience limits. */
export function StepAudiencePricing({
  eventId,
  rows,
  onRowsChange,
  rowErrors,
  serverError,
  quickAddOpen,
  onQuickAddOpenChange,
  onQuickAddSavingChange,
  onRegistrationTypeSaved,
  defaultLimit,
  onDefaultLimitChange,
  busy,
}: StepAudiencePricingProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const idPrefix = useId();
  const defaultDraft = rows.find((row) => row.isDefaultDraft && row.included);

  // Focus a newly created audience's price once its card has mounted.
  useEffect(() => {
    if (pendingFocusId) {
      document.getElementById(`${idPrefix}-price-${pendingFocusId}`)?.focus();
      setPendingFocusId(null);
    }
  }, [pendingFocusId, idPrefix]);
  useEffect(() => {
    if (rowErrors.defaultCapacity) setAdvancedOpen(true);
  }, [rowErrors.defaultCapacity]);

  /** Updates one audience while preserving all other prices and selections. */
  const updateRow = (id: string, values: Partial<TicketWizardAudienceRow>) => {
    onRowsChange((current) =>
      current.map((row) =>
        row.registrationTypeId === id ? { ...row, ...values } : row,
      ),
    );
  };

  /** Includes the saved audience with the price entered in its creation form. */
  const handleQuickAddCreated = (created: {
    id: string;
    name: string;
    code: string;
    price: string;
    capacity: number | null;
  }) => {
    onRowsChange((current) => [
      ...current,
      {
        registrationTypeId: created.id,
        name: created.name,
        code: created.code,
        included: true,
        price: created.price,
        capacity: created.capacity,
      },
    ]);
    onQuickAddOpenChange(false);
    setPendingFocusId(created.id);
    onRegistrationTypeSaved({
      id: created.id,
      name: created.name,
      code: created.code,
      capacity: created.capacity,
      registeredCount: 0,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Who can buy this ticket?</h3>
        <p className="text-sm text-muted-foreground">
          Choose your audiences and set their prices. Enter 0 for a free ticket.
        </p>
      </div>
      {serverError || rowErrors.audience ? (
        <p role="alert" className="text-sm text-destructive">
          {serverError || rowErrors.audience}
        </p>
      ) : null}
      <div className="space-y-3">
        {rows.map((row) => {
          const priceId = `${idPrefix}-price-${row.registrationTypeId}`;
          const rowError = rowErrors[row.registrationTypeId];
          return (
            <div
              key={row.registrationTypeId}
              className="space-y-3 rounded-lg border border-border p-4"
            >
              <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
                <Checkbox
                  checked={row.included}
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    updateRow(row.registrationTypeId, {
                      included: checked === true,
                    })
                  }
                  aria-label={`Include ${row.name}`}
                />
                {row.name}
              </label>
              <div className="space-y-2">
                <label htmlFor={priceId} className="text-sm">
                  Ticket price ({WIZARD_DEFAULT_CURRENCY})
                </label>
                <Input
                  id={priceId}
                  value={row.price}
                  disabled={!row.included || busy}
                  onChange={(event) =>
                    updateRow(row.registrationTypeId, {
                      price: event.target.value,
                    })
                  }
                  placeholder="0.00"
                  inputMode="decimal"
                  aria-label={`Price for ${row.name}`}
                  aria-invalid={!!rowError}
                  aria-describedby={rowError ? `${priceId}-error` : undefined}
                />
                {rowError ? (
                  <p
                    id={`${priceId}-error`}
                    className="text-xs text-destructive"
                  >
                    {rowError}
                  </p>
                ) : null}
              </div>
              {row.capacity != null ? (
                <p className="text-xs text-muted-foreground">
                  Audience limit: {row.capacity} across all tickets. Manage this
                  in Registration types.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={quickAddOpen || busy}
        onClick={() => onQuickAddOpenChange(true)}
      >
        <Plus aria-hidden="true" />
        Add registration type
      </Button>
      {quickAddOpen ? (
        <RegistrationTypeQuickAdd
          eventId={eventId}
          onCreated={handleQuickAddCreated}
          onCancel={() => onQuickAddOpenChange(false)}
          onSavingChange={onQuickAddSavingChange}
        />
      ) : null}
      {defaultDraft ? (
        <details
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Advanced audience settings
          </summary>
          {advancedOpen ? (
            <div className="space-y-3 pt-4">
              <label className="flex items-center justify-between gap-3 text-sm">
                Limit this audience across all tickets
                <Switch
                  checked={defaultLimit.limited}
                  disabled={busy}
                  onCheckedChange={(limited) =>
                    onDefaultLimitChange({ ...defaultLimit, limited })
                  }
                  aria-label="Limit General attendee across all tickets"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                A shared quota for General attendees, including other tickets
                they buy.
              </p>
              {defaultLimit.limited ? (
                <div className="space-y-2">
                  <label
                    htmlFor={`${idPrefix}-default-capacity`}
                    className="text-sm"
                  >
                    Audience limit
                  </label>
                  <Input
                    id={`${idPrefix}-default-capacity`}
                    type="number"
                    min={1}
                    step={1}
                    disabled={busy}
                    value={defaultLimit.capacity}
                    onChange={(event) =>
                      onDefaultLimitChange({
                        ...defaultLimit,
                        capacity: event.target.value,
                      })
                    }
                    aria-invalid={!!rowErrors.defaultCapacity}
                    aria-describedby={
                      rowErrors.defaultCapacity
                        ? `${idPrefix}-capacity-error`
                        : undefined
                    }
                  />
                  {rowErrors.defaultCapacity ? (
                    <p
                      id={`${idPrefix}-capacity-error`}
                      className="text-xs text-destructive"
                    >
                      {rowErrors.defaultCapacity}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </details>
      ) : null}
      {quickAddOpen ? (
        <p className="text-xs text-muted-foreground">
          Add or cancel the new registration type before continuing.
        </p>
      ) : null}
    </div>
  );
}
