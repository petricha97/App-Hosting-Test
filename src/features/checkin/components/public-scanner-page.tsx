"use client";

// Public scanner page shell (M5-T5, design §4): standalone, mobile-first,
// no dashboard chrome. Two states:
//   no session -> access-code gate;
//   session    -> scanner surface (team mode).
// The session token lives in sessionStorage (per event key), is sent only in
// request BODIES, and any 401 clears it and returns here with the
// "Session expired" notice. Expiry is also pre-checked client-side from the
// token's embedded expiresAtMs so a stale tab lands on the gate, not a 401.

import { useEffect, useState } from "react";

import { AccessCodeGate } from "@/features/checkin/components/access-code-gate";
import { ScannerSurface } from "@/features/checkin/components/scanner-surface";

interface PublicScannerPageProps {
  eventId: string;
  eventName: string;
}

interface StoredSession {
  token: string;
  memberName: string;
}

function storageKey(eventId: string) {
  return `scanner-session:${eventId}`;
}

// Client-side convenience only — the server re-verifies expiry + signature
// + isActive on every request.
function isSessionUsable(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const expiresAtMs = Number(parts[1]);
  return Number.isFinite(expiresAtMs) && Date.now() < expiresAtMs;
}

export function PublicScannerPage({
  eventId,
  eventName,
}: PublicScannerPageProps) {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // sessionStorage is read in an effect (not render) so SSR and the first
  // client render agree — no hydration mismatch.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(storageKey(eventId));
      if (raw) {
        const stored = JSON.parse(raw) as StoredSession;
        if (stored.token && isSessionUsable(stored.token)) {
          setSession(stored);
        } else {
          window.sessionStorage.removeItem(storageKey(eventId));
        }
      }
    } catch {
      // Storage unavailable (private mode) — the gate still works, the
      // session just won't survive a reload.
    }
    setHydrated(true);
  }, [eventId]);

  const startSession = (next: StoredSession) => {
    setSession(next);
    setNotice(null);
    try {
      window.sessionStorage.setItem(storageKey(eventId), JSON.stringify(next));
    } catch {
      // Best-effort persistence only.
    }
  };

  const expireSession = () => {
    setSession(null);
    setNotice("Session expired — enter your code again.");
    try {
      window.sessionStorage.removeItem(storageKey(eventId));
    } catch {
      // Ignore.
    }
  };

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b px-4 py-3 text-center">
        <p className="text-sm font-medium text-foreground">{eventName}</p>
        <p className="text-xs text-muted-foreground">
          Check-in scanner
          {session?.memberName ? ` · ${session.memberName}` : ""}
        </p>
      </header>

      <main className="flex flex-1 flex-col justify-center px-4 py-6">
        {!hydrated ? null : session ? (
          <ScannerSurface
            eventId={eventId}
            mode={{
              kind: "team",
              sessionToken: session.token,
              onSessionExpired: expireSession,
            }}
          />
        ) : (
          <AccessCodeGate
            eventId={eventId}
            notice={notice}
            onSession={startSession}
          />
        )}
      </main>
    </div>
  );
}
