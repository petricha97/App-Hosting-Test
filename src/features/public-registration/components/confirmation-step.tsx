"use client";

// Step 5 — Confirmation (design §3, M5 design §4 retrofit): registration
// reference (FormData id short code), order reference + amount/status line,
// and the REAL entry-pass QR (server-rendered SVG from FinalizeSuccess.qrSvg,
// M5-T1). Legacy payloads without qrSvg keep the dashed placeholder. Wallet
// buttons are visual placeholders (Q4 locked) — disabled, with a
// keyboard-reachable "coming soon" tooltip. Focus lands on the heading.

import { useEffect, useRef } from "react";
import { CheckCircle2, QrCode, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

// Disabled wallet placeholder pill (M5 design §4): disabled buttons swallow
// pointer events, so the tooltip trigger is a keyboard-reachable span wrapper;
// the "coming soon" copy is also mirrored via aria-describedby.
function WalletPlaceholderButton({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-describedby="wallet-coming-soon" className="inline-flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            className="pointer-events-none rounded-full"
          >
            <Wallet aria-hidden="true" />
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Wallet passes are coming soon.</TooltipContent>
    </Tooltip>
  );
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
        {result.qrSvg ? (
          // White backing panel keeps scan contrast in dark surroundings; the
          // attendee-facing QR is CONTENT, so role="img" + label (design §4).
          <div
            role="img"
            aria-label="Your entry QR code"
            className="mx-auto h-40 w-40 rounded-2xl border border-slate-200 bg-white p-3 [&_svg]:h-full [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: result.qrSvg }}
          />
        ) : (
          // Legacy payloads without qrSvg keep the dashed placeholder.
          <div className="mx-auto grid h-40 w-40 place-items-center rounded-2xl border-2 border-dashed border-slate-300">
            <QrCode className="h-10 w-10 text-slate-400" aria-hidden />
          </div>
        )}
        <p className="text-sm font-medium text-slate-950">Your entry pass</p>
        <p className="text-xs text-slate-500">
          {result.qrSvg
            ? "Show this QR at the door — it's also in your confirmation email."
            : "Your QR code will appear here and in your confirmation email."}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <WalletPlaceholderButton label="Add to Apple Wallet" />
          <WalletPlaceholderButton label="Add to Google Wallet" />
        </div>
        <p id="wallet-coming-soon" className="sr-only">
          Wallet passes are coming soon.
        </p>
      </div>
    </div>
  );
}
