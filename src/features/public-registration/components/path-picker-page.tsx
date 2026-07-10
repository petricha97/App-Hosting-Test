// Path picker (M3-T3 AC-1, design §3): shown when the event has 2+ active
// registration paths and no ?path= was chosen. Server component — pure links,
// no client state. Public-events look: light theme only.

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import type { PaymentMethod } from "@/types/collection";

export interface PathPickerItem {
  id: string;
  name: string;
  audienceName: string | null;
  paymentMethod: PaymentMethod;
}

const PAYMENT_META_LABELS: Record<PaymentMethod, string> = {
  card: "Pays by card",
  invoice: "Invoiced",
  comp: "Complimentary",
  none: "Free",
};

interface PathPickerPageProps {
  eventId: string;
  eventName: string;
  paths: PathPickerItem[];
}

export function PathPickerPage({ eventId, eventName, paths }: PathPickerPageProps) {
  return (
    <main className="min-h-screen bg-[#fff8f1] pb-20 pt-28 text-slate-900 sm:pt-32">
      <div className="mx-auto w-full max-w-2xl space-y-8 px-4">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-orange-900">
            {eventName}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            How are you registering?
          </h1>
          <p className="text-base leading-7 text-slate-600">
            Pick the option that matches you — each one has its own steps and
            payment method.
          </p>
        </div>

        <ul className="space-y-4">
          {paths.map((path) => (
            <li key={path.id}>
              <Link
                href={`/events/${eventId}/register?path=${path.id}`}
                className="flex items-center justify-between gap-3 rounded-[1.5rem] border border-slate-200 bg-white p-5 transition hover:border-orange-300"
              >
                <span>
                  <span className="block text-lg font-semibold text-slate-950">
                    {path.name}
                  </span>
                  <span className="mt-1 block text-sm text-slate-600">
                    {path.audienceName ?? "Anyone"} ·{" "}
                    {PAYMENT_META_LABELS[path.paymentMethod]}
                  </span>
                </span>
                <ChevronRight
                  className="h-5 w-5 shrink-0 text-slate-400"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>

        <p className="text-sm text-slate-500">
          <Link
            href={`/events/${eventId}`}
            className="font-medium text-orange-900 underline-offset-4 hover:underline"
          >
            Back to the event page
          </Link>
        </p>
      </div>
    </main>
  );
}
