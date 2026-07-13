"use client";

// Shared scanner surface (M5-T5, design §4) — used by BOTH the public
// team-session scanner (/scan/[eventId]) and the dashboard admin scanner
// (/dashboard/events/[eventId]/checkin/scan). Mobile-first (375px), ≥44px
// touch targets.
//
// - Camera viewport: `qr-scanner` (nimiq, worker-based), DYNAMICALLY
//   imported inside the effect so it never touches the server bundle.
// - Camera-permission-denied: the viewport swaps to the CameraOff panel and
//   the manual entry auto-expands (AC-11).
// - Manual token entry: ALWAYS available (testability + fallback, AC-4) —
//   feeds the exact same resolve endpoint as camera scans.
// - Resolve-then-confirm: a scan shows the attendee card first (resolve
//   never writes); the h-14 "Check in" button fires the idempotent confirm.
// - Session expiry (team mode): any 401 hands control back to the gate via
//   onSessionExpired.

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraOff, Loader2 } from "lucide-react";
import type QrScannerType from "qr-scanner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  outcomeFromConfirm,
  outcomeFromResolve,
  type ScanConfirmResponse,
  type ScanOutcome,
  type ScanResolveResponse,
} from "@/features/checkin/scan-types";
import { ScanResultCard } from "@/features/checkin/components/scan-result-card";

export type ScannerMode =
  // Public door scanner — authenticates every call with the session token.
  | { kind: "team"; sessionToken: string; onSessionExpired: () => void }
  // Dashboard scanner — the admin session cookie authenticates.
  | { kind: "admin" };

interface ScannerSurfaceProps {
  eventId: string;
  mode: ScannerMode;
}

type CameraState = "starting" | "active" | "denied";

export function ScannerSurface({ eventId, mode }: ScannerSurfaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<QrScannerType | null>(null);
  // Guards double-fire: camera decoders emit the same code many times per
  // second, and a shown result must swallow further reads until "Scan next".
  const busyRef = useRef(false);

  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [lastToken, setLastToken] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rateLimitedMessage, setRateLimitedMessage] = useState<string | null>(
    null,
  );

  const base =
    mode.kind === "team"
      ? `/api/events/${encodeURIComponent(eventId)}/checkin`
      : `/api/dashboard/events/${encodeURIComponent(eventId)}/checkin`;

  const post = useCallback(
    async (path: "resolve" | "confirm", qrToken: string) => {
      return fetch(`${base}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode.kind === "team"
            ? { sessionToken: mode.sessionToken, qrToken }
            : { qrToken },
        ),
      });
    },
    [base, mode],
  );

  const handleScan = useCallback(
    async (qrToken: string) => {
      const trimmed = qrToken.trim();
      if (trimmed.length === 0 || busyRef.current) return;
      busyRef.current = true;
      setResolving(true);
      setRateLimitedMessage(null);

      try {
        const response = await post("resolve", trimmed);
        if (response.status === 401 && mode.kind === "team") {
          mode.onSessionExpired();
          return;
        }
        if (response.status === 429) {
          setRateLimitedMessage("Too many scans — wait a moment.");
          busyRef.current = false;
          return;
        }
        if (!response.ok) {
          setOutcome({ kind: "error" });
          return;
        }

        const data = (await response.json()) as ScanResolveResponse;
        setLastToken(trimmed);
        setOutcome(outcomeFromResolve(data));
      } catch {
        setOutcome({ kind: "error" });
      } finally {
        setResolving(false);
      }
    },
    [mode, post],
  );

  const handleConfirm = useCallback(async () => {
    if (!lastToken) return;
    setConfirming(true);
    try {
      const response = await post("confirm", lastToken);
      if (response.status === 401 && mode.kind === "team") {
        mode.onSessionExpired();
        return;
      }
      if (!response.ok) {
        setOutcome({ kind: "error" });
        return;
      }

      const data = (await response.json()) as ScanConfirmResponse;
      setOutcome(outcomeFromConfirm(data));
    } catch {
      setOutcome({ kind: "error" });
    } finally {
      setConfirming(false);
    }
  }, [lastToken, mode, post]);

  const scanNext = useCallback(() => {
    setOutcome(null);
    setLastToken(null);
    setManualToken("");
    busyRef.current = false;
    viewportRef.current?.focus();
  }, []);

  // Latest-callback ref so the camera effect can run ONCE: the decode
  // callback always sees the current handler without the effect (and the
  // camera stream) being torn down on every state-driven re-render.
  const handleScanRef = useRef(handleScan);
  useEffect(() => {
    handleScanRef.current = handleScan;
  }, [handleScan]);

  // Camera lifecycle. qr-scanner is client-only (workers + getUserMedia) —
  // the dynamic import keeps it out of SSR and out of non-scanner bundles.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { default: QrScanner } = await import("qr-scanner");
        if (cancelled || !videoRef.current) return;

        const scanner = new QrScanner(
          videoRef.current,
          (result) => void handleScanRef.current(result.data),
          {
            returnDetailedScanResult: true,
            preferredCamera: "environment",
          },
        );
        scannerRef.current = scanner;
        await scanner.start();
        if (cancelled) {
          scanner.destroy();
          return;
        }
        setCameraState("active");
      } catch {
        // Permission denied / no camera / insecure context: slate panel +
        // auto-expanded manual entry (AC-11).
        if (!cancelled) {
          setCameraState("denied");
          setManualOpen(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
    // Mount-only by design: handleScanRef keeps the callback fresh.
  }, []);

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div
        ref={viewportRef}
        tabIndex={-1}
        className="relative aspect-square w-full overflow-hidden rounded-xl border bg-black outline-none"
      >
        {cameraState === "denied" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-slate-100 px-6 text-center dark:bg-slate-900">
            <CameraOff
              aria-hidden="true"
              className="h-10 w-10 text-slate-500 dark:text-slate-400"
            />
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Camera unavailable — allow camera access or enter the code
              manually.
            </p>
          </div>
        ) : (
          <>
            {/* Live camera feed — no audio track, no captions applicable. */}
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              playsInline
              muted
            />
            {/* Decorative corner brackets over the viewport. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-8"
            >
              {(
                [
                  "left-0 top-0 border-l-4 border-t-4",
                  "right-0 top-0 border-r-4 border-t-4",
                  "bottom-0 left-0 border-b-4 border-l-4",
                  "bottom-0 right-0 border-b-4 border-r-4",
                ] as const
              ).map((corner) => (
                <span
                  key={corner}
                  className={`absolute h-8 w-8 rounded-sm border-white/80 ${corner}`}
                />
              ))}
            </div>
            {cameraState === "starting" ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2
                  aria-hidden="true"
                  className="h-8 w-8 animate-spin text-white/80"
                />
                <span className="sr-only">Starting camera…</span>
              </div>
            ) : null}
          </>
        )}
      </div>

      {resolving ? (
        <p
          role="status"
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Looking up pass…
        </p>
      ) : null}
      {rateLimitedMessage ? (
        <p role="alert" className="text-center text-sm text-destructive">
          {rateLimitedMessage}
        </p>
      ) : null}

      <div className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          className="h-12 w-full"
          aria-expanded={manualOpen}
          onClick={() => setManualOpen((open) => !open)}
        >
          Enter code manually
        </Button>
        {manualOpen ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleScan(manualToken);
            }}
          >
            <Label htmlFor="manual-qr-token" className="sr-only">
              Pass code
            </Label>
            <Input
              id="manual-qr-token"
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              placeholder="Paste the pass code"
              className="h-12 font-mono"
              autoComplete="off"
              maxLength={512}
            />
            <Button
              type="submit"
              className="h-12 w-full"
              disabled={resolving || manualToken.trim().length === 0}
            >
              Look up
            </Button>
          </form>
        ) : null}
      </div>

      {outcome ? (
        <ScanResultCard
          outcome={outcome}
          confirming={confirming}
          onConfirm={outcome.kind === "resolved" ? () => void handleConfirm() : undefined}
          onScanNext={scanNext}
        />
      ) : null}
    </div>
  );
}
