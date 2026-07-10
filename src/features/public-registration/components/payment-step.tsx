"use client";

// Step 4 — Payment (design §3). Card paths render a SIMULATED card form:
// format-only client checks, and the values are NEVER transmitted — the
// finalize request body is { token } only (the provider is simulated
// server-side; spec Q3/PII: card data never reaches our server). Invoice
// paths render a billing-terms confirmation with no inputs. Comp/none paths
// never render this step.

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PaymentStepProps {
  method: "card" | "invoice";
  email: string;
}

export interface CardFormState {
  nameOnCard: string;
  cardNumber: string;
  expiry: string;
  cvc: string;
}

// Format-only validity: the simulated flow needs plausible inputs, nothing
// more. Exported for the stepper's Continue gate.
export function isCardFormPlausible(card: CardFormState): boolean {
  return (
    card.nameOnCard.trim().length > 0 &&
    card.cardNumber.replace(/\s+/g, "").length >= 12 &&
    /^\d{2}\s*\/\s*\d{2}$/.test(card.expiry.trim()) &&
    /^\d{3,4}$/.test(card.cvc.trim())
  );
}

export function PaymentStep({
  method,
  email,
  card,
  onCardChange,
}: PaymentStepProps & {
  card: CardFormState;
  onCardChange: (card: CardFormState) => void;
}) {
  const [touched, setTouched] = useState(false);

  if (method === "invoice") {
    return (
      <div className="space-y-4">
        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 text-sm leading-7 text-slate-700">
          You&apos;ll receive an invoice{email ? ` at ${email}` : ""}. Your
          place is held once you confirm.
        </div>
      </div>
    );
  }

  const plausible = isCardFormPlausible(card);

  return (
    <div className="space-y-4">
      <div className="rounded-[1.5rem] border border-orange-200 bg-orange-50 p-4 text-sm leading-6 text-orange-900">
        Simulated payment — no real charge is made in this environment. Card
        details stay in your browser and are never sent to our servers.
      </div>

      <div className="space-y-2">
        <Label htmlFor="card-name">Name on card</Label>
        <Input
          id="card-name"
          autoComplete="cc-name"
          value={card.nameOnCard}
          onChange={(event) =>
            onCardChange({ ...card, nameOnCard: event.target.value })
          }
          onBlur={() => setTouched(true)}
          className="h-12 rounded-2xl border-slate-200 bg-slate-50"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="card-number">Card number</Label>
        <Input
          id="card-number"
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="4242 4242 4242 4242"
          value={card.cardNumber}
          onChange={(event) =>
            onCardChange({ ...card, cardNumber: event.target.value })
          }
          onBlur={() => setTouched(true)}
          className="h-12 rounded-2xl border-slate-200 bg-slate-50"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="card-expiry">Expiry</Label>
          <Input
            id="card-expiry"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM / YY"
            value={card.expiry}
            onChange={(event) =>
              onCardChange({ ...card, expiry: event.target.value })
            }
            onBlur={() => setTouched(true)}
            className="h-12 rounded-2xl border-slate-200 bg-slate-50"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="card-cvc">CVC</Label>
          <Input
            id="card-cvc"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="123"
            value={card.cvc}
            onChange={(event) =>
              onCardChange({ ...card, cvc: event.target.value })
            }
            onBlur={() => setTouched(true)}
            className="h-12 rounded-2xl border-slate-200 bg-slate-50"
          />
        </div>
      </div>

      {touched && !plausible ? (
        <p className="text-sm text-red-600">
          Enter a name, card number, expiry (MM / YY) and CVC to continue.
        </p>
      ) : null}
    </div>
  );
}
