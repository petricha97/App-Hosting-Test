"use client";

// Public flow stepper header (design §3). Circles are STATIC — never
// buttons — so there is zero tamper surface; the Back button is the only
// backward navigation (T3 AC-2).

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FlowStep } from "@/features/public-registration/steps";

interface StepperHeaderProps {
  steps: FlowStep[];
  currentIndex: number;
}

export function StepperHeader({ steps, currentIndex }: StepperHeaderProps) {
  return (
    <nav aria-label="Registration steps">
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isCompleted = index < currentIndex;

          return (
            <li
              key={step.id}
              className={cn(
                "flex items-center gap-2",
                index < steps.length - 1 && "flex-1",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden={!isCurrent}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm font-semibold",
                    isCurrent && "border-orange-600 bg-orange-600 text-white",
                    isCompleted && "border-orange-100 bg-orange-100 text-orange-900",
                    !isCurrent && !isCompleted && "border-slate-200 text-slate-400",
                  )}
                >
                  {isCompleted ? (
                    <>
                      <Check className="h-4 w-4" aria-hidden />
                      <span className="sr-only">completed</span>
                    </>
                  ) : (
                    step.number
                  )}
                </span>
                <span
                  className={cn(
                    "text-xs sm:text-sm",
                    isCurrent
                      ? "block font-semibold text-slate-950"
                      : "hidden text-slate-500 sm:block",
                  )}
                >
                  {step.title}
                </span>
              </span>
              {index < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "h-px flex-1",
                    isCompleted ? "bg-orange-300" : "bg-slate-200",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
