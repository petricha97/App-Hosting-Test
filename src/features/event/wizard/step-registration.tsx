"use client";

import { FileText, Ticket } from "lucide-react";

/** CREATE wizard — Step 3 (optional). Informational only: the registration form
 *  is built/linked later from the event's Forms area, so this step has no inputs
 *  and never blocks "Next". */
export function StepRegistration() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3 rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/90 px-6 py-8 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500">
          <FileText className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-slate-950">
          No registration form linked yet
        </p>
        <p className="max-w-md text-sm leading-6 text-slate-600">
          You can link a registration form after the event is created — build it
          from the event&apos;s Forms area whenever you&apos;re ready. Nothing
          is required here to continue.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-[1.5rem] bg-orange-50 px-4 py-3 text-sm leading-6 text-slate-600">
        <Ticket className="mt-0.5 h-4 w-4 flex-none text-orange-900" />
        <p>
          <span className="font-semibold text-slate-900">
            Tickets, pricing, taxes and discounts
          </span>{" "}
          are configured on the event&apos;s own screens after it&apos;s created
          — so this step stays short.
        </p>
      </div>
    </div>
  );
}
