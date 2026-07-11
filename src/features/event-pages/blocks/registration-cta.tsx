"use client";

// M4-T1 block 3 — the retargeted RegistrationEmbed's CTA card, shared by the
// public and dashboard renderers (design §3). Rendered only when the event
// has registration paths ("open"/"closed"); the 0-paths legacy inline form
// branch stays in puck.tsx (AC-14). All props render as React text (AC-17).

import Link from "next/link";

interface RegistrationCtaCardProps {
  title: string;
  body: string;
  buttonLabel: string;
  // "open" → live CTA into the M3 flow (AC-13); "closed" → disabled,
  // non-focusable notice — never a dead link, never hidden (AC-15).
  state: "open" | "closed";
  registerHref: string;
  // Public: real link. Editor: non-navigating preview + caption.
  variant: "public" | "editor";
  // Editor-only link target for the amber "no active paths" note.
  pathsHref?: string;
}

export function RegistrationCtaCard({
  title,
  body,
  buttonLabel,
  state,
  registerHref,
  variant,
  pathsHref,
}: RegistrationCtaCardProps) {
  return (
    <section className="rounded-[2rem] border border-dashed border-orange-300 bg-orange-50/70 px-6 py-8 sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-900">
        Registration
      </p>
      <h3 className="mt-3 text-2xl font-semibold text-slate-950">{title}</h3>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">{body}</p>

      {state === "open" ? (
        <div className="mt-6 space-y-3">
          {variant === "public" ? (
            <Link
              href={registerHref}
              className="inline-flex w-full items-center justify-center rounded-full bg-[#ff7a59] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#ff6a45] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 sm:w-auto"
            >
              {buttonLabel}
            </Link>
          ) : (
            <>
              <span className="inline-flex w-full items-center justify-center rounded-full bg-[#ff7a59] px-5 py-3 text-sm font-semibold text-white sm:w-auto">
                {buttonLabel}
              </span>
              <p className="text-xs leading-6 text-slate-500">
                Links to the public registration flow.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {/* Disabled notice: a span, so it is neither focusable nor a dead
              link; aria-disabled communicates the state (AC-15). */}
          <span
            aria-disabled="true"
            className="inline-flex w-full items-center justify-center rounded-full bg-slate-200 px-5 py-3 text-sm font-semibold text-slate-500 sm:w-auto"
          >
            {buttonLabel}
          </span>
          <p className="text-sm leading-7 text-slate-600">
            Registration is currently closed. Check back soon.
          </p>
          {variant === "editor" && pathsHref ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              No active registration paths —{" "}
              <Link
                href={pathsHref}
                className="font-semibold underline underline-offset-4"
              >
                activate one under Registration Paths
              </Link>
              , or publish the event form.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
