"use client";

// M4-T1 block 2 — Countdown timer. Hydration-safe by construction (AC-12):
// the server (and first client paint) renders the four unit tiles with "--"
// placeholders at reserved widths; a useEffect starts the 1s interval after
// mount and swaps real values in. No Date.now() during render, so the server
// and client markup always match, and tabular numerals + min-width spans
// prevent layout shift as digits change.
//
// The target is resolved from injected data (eventStartIso follows the event
// doc per request — AC-9); customDateTime is parsed, never echoed into
// attributes (AC-17). Past/reached targets render completedMessage — never
// negative digits (AC-11).

import { useEffect, useState } from "react";

import {
  diffCountdown,
  formatCountdownTarget,
  resolveCountdownTargetMs,
  type CountdownParts,
} from "@/features/event-pages/countdown";

export const COUNTDOWN_DEFAULT_COMPLETED_MESSAGE = "The event has started.";

interface CountdownBlockProps {
  title: string;
  target: string;
  customDateTime: string;
  completedMessage: string;
  eventStartIso: string | null;
  timezone: string;
  // Editor-only "target has passed" hint chip.
  editorHint?: boolean;
}

const UNITS: Array<{ key: keyof CountdownParts; label: string }> = [
  { key: "days", label: "Days" },
  { key: "hours", label: "Hrs" },
  { key: "minutes", label: "Min" },
  { key: "seconds", label: "Sec" },
];

function padUnit(key: keyof CountdownParts, value: number): string {
  return key === "days" ? String(value) : String(value).padStart(2, "0");
}

export function CountdownBlock({
  title,
  target,
  customDateTime,
  completedMessage,
  eventStartIso,
  timezone,
  editorHint = false,
}: CountdownBlockProps) {
  // Resolved once per render from injected data. Offset-less custom values
  // are anchored to the EVENT timezone (never the runtime's), so this — and
  // the absolute-target line derived from it below — is identical on the
  // server and every hydrating client (AC-12).
  const targetMs = resolveCountdownTargetMs({
    target,
    customDateTime,
    eventStartIso,
    timezone,
  });

  // null until mounted → deterministic "--" placeholders on SSR + hydration.
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const resolvedCompletedMessage =
    completedMessage.trim().length > 0
      ? completedMessage
      : COUNTDOWN_DEFAULT_COMPLETED_MESSAGE;

  // No resolvable target at all (no custom, no event start): the message is
  // known server-side, render it statically (AC-10) — no live region needed.
  if (targetMs === null) {
    return (
      <section className="rounded-[2rem] border border-slate-200 bg-white px-6 py-8 text-center sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-900">
          {title}
        </p>
        <p className="mt-4 text-2xl font-semibold text-slate-950">
          {resolvedCompletedMessage}
        </p>
      </section>
    );
  }

  const parts = nowMs === null ? null : diffCountdown(targetMs, nowMs);
  // Completion is only ever observed client-side (pre-mount renders tiles),
  // so the role="status" node appears exactly once, when the digits give way
  // to the message.
  const completed = nowMs !== null && parts === null;
  const absoluteTarget = formatCountdownTarget(targetMs, timezone);

  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white px-6 py-8 text-center sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-900">
        {title}
      </p>

      {/* Static fact for screen readers — the ticker itself is aria-hidden. */}
      <p className="sr-only">
        {title}: {absoluteTarget}
      </p>

      {completed ? (
        <p role="status" className="mt-4 text-2xl font-semibold text-slate-950">
          {resolvedCompletedMessage}
        </p>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="mt-6 flex flex-wrap justify-center gap-6 sm:gap-10"
          >
            {UNITS.map((unit) => (
              <div key={unit.key} className="flex flex-col items-center gap-1">
                <span
                  className={`inline-block text-3xl font-semibold tabular-nums text-slate-950 sm:text-4xl ${
                    unit.key === "days" ? "min-w-[3ch]" : "min-w-[2ch]"
                  }`}
                >
                  {parts ? padUnit(unit.key, parts[unit.key]) : "--"}
                </span>
                <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
                  {unit.label}
                </span>
              </div>
            ))}
          </div>
          <p aria-hidden="true" className="mt-5 text-sm leading-6 text-slate-500">
            {absoluteTarget}
          </p>
        </>
      )}

      {editorHint && nowMs !== null && targetMs <= nowMs ? (
        <p className="mt-4 inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
          Target date has passed
        </p>
      ) : null}
    </section>
  );
}
