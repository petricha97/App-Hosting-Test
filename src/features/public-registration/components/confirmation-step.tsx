"use client";

// Step 5 — Confirmation (design §3): registration reference (FormData id
// short code), order reference + amount/status line, and the QR PLACEHOLDER
// (the real QR mint is M5-T1 and retrofits here). Focus lands on the heading.

import { useEffect, useRef } from "react";
import { CheckCircle2, QrCode } from "lucide-react";

import { formatMoney } from "@/features/pricing/utils";
import type { FinalizeSuccess } from "@/features/public-registration/types";

const STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  outstanding: "Invoice to follow",
  comped: "Complimentary",
};

interface ConfirmationStepProps {
  result: FinalizeSuccess;
}

// Short display code from the (long, hash-derived) FormData id.
export function shortRegistrationRef(registrationRef: string): string {
  return `REG-${registrationRef.slice(0, 8).toUpperCase()}`;
}

export function ConfirmationStep({ result }: ConfirmationStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const amountLabel =
    result.amounts.totalMinor === 0
      ? "Comp"
      : formatMoney(result.amounts.totalMinor, result.currency);

  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
        <CheckCircle2 className="h-8 w-8" aria-hidden />
      </div>

      <div className="space-y-2">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold text-slate-950 outline-none"
        >
          You&apos;re registered!
        </h3>
        <p className="text-sm leading-6 text-slate-600">
          Keep your references handy — a confirmation email is on its way.
        </p>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Registration reference
        </p>
        <p className="font-mono text-xl font-semibold text-slate-950">
          {shortRegistrationRef(result.registrationRef)}
        </p>
        <p className="text-sm text-slate-600">
          Order{" "}
          <span className="font-mono">{result.orderRef.slice(0, 12)}</span> ·{" "}
          {amountLabel} ·{" "}
          {STATUS_LABELS[result.paymentStatus] ?? result.paymentStatus}
        </p>
      </div>

      <div className="space-y-2">
        <div className="mx-auto grid h-40 w-40 place-items-center rounded-2xl border-2 border-dashed border-slate-300">
          <QrCode className="h-10 w-10 text-slate-400" aria-hidden />
        </div>
        <p className="text-sm font-medium text-slate-950">Your entry pass</p>
        <p className="text-xs text-slate-500">
          Your QR code will appear here and in your confirmation email.
        </p>
      </div>
    </div>
  );
}
