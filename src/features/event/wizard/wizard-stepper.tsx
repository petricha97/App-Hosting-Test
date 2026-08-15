"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { WizardStep } from "@/features/event/wizard/steps";

interface WizardStepperProps {
  steps: readonly WizardStep[];
  currentIndex: number;
  visited: readonly boolean[];
  errored: readonly boolean[];
  onJump: (index: number) => void;
}

type StepState = "done" | "current" | "error" | "upcoming";

/** Decide how a step bubble should render: errored steps (other than the one
 *  you're on) show red; the active step is "current"; visited steps are "done";
 *  the rest are "upcoming". */
function resolveState(
  index: number,
  currentIndex: number,
  visited: boolean,
  errored: boolean,
): StepState {
  if (errored && index !== currentIndex) return "error";
  if (index === currentIndex) return "current";
  if (visited) return "done";
  return "upcoming";
}

/** The horizontal progress rail. Renders one bubble per step; visited steps are
 *  clickable to jump back via `onJump`. Presentational only — all state is
 *  passed in from the wizard container. */
export function WizardStepper({
  steps,
  currentIndex,
  visited,
  errored,
  onJump,
}: WizardStepperProps) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-start">
        {steps.map((step, index) => {
          const state = resolveState(
            index,
            currentIndex,
            visited[index],
            errored[index],
          );
          const isClickable = visited[index] && index !== currentIndex;

          return (
            <li
              key={step.key}
              className="relative flex flex-1 flex-col items-center gap-2"
            >
              {index > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[-50%] right-1/2 top-[18px] h-0.5",
                    state === "done" || state === "current"
                      ? "bg-orange-400"
                      : "bg-slate-200 dark:bg-slate-700",
                  )}
                />
              ) : null}

              <button
                type="button"
                disabled={!isClickable}
                aria-current={state === "current" ? "step" : undefined}
                onClick={() => isClickable && onJump(index)}
                className={cn(
                  "group z-10 flex flex-col items-center gap-2 bg-transparent",
                  isClickable ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition",
                    state === "done" &&
                      "border-orange-400 bg-orange-400 text-white",
                    state === "current" &&
                      "border-orange-400 text-orange-600 shadow-[0_0_0_4px_rgba(251,146,60,0.25)] dark:text-orange-300",
                    state === "error" &&
                      "border-destructive bg-destructive/10 text-destructive",
                    state === "upcoming" &&
                      "border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500",
                  )}
                >
                  {state === "done" ? (
                    <Check className="h-4 w-4" />
                  ) : state === "error" ? (
                    "!"
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    "hidden max-w-[12ch] text-center text-xs font-semibold sm:block",
                    state === "current" && "text-slate-900 dark:text-slate-100",
                    state === "done" && "text-slate-600 dark:text-slate-300",
                    state === "error" && "text-destructive",
                    state === "upcoming" &&
                      "text-slate-400 dark:text-slate-500",
                  )}
                >
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
