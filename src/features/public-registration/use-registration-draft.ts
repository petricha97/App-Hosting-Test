"use client";

// Draft-token/session hook for the public flow (M3-T3 resume, design §3).
// The signed token is kept in sessionStorage keyed by eventId — never in
// URLs (referrer leakage) — and travels only in request bodies / the
// x-draft-token header. A new browser/session simply starts a fresh draft
// (the old one becomes an abandoned record, T5).

import { useCallback, useRef } from "react";

import type { DraftResumeState } from "@/features/public-registration/types";

function storageKey(eventId: string): string {
  return `registration-draft:${eventId}`;
}

function readToken(eventId: string): string | null {
  try {
    return window.sessionStorage.getItem(storageKey(eventId));
  } catch {
    // Storage unavailable (private mode restrictions) — flow still works,
    // it just cannot resume across reloads.
    return null;
  }
}

export interface UseRegistrationDraftResult {
  getToken: () => string | null;
  saveToken: (token: string) => void;
  clearToken: () => void;
  // GET-by-token hydration; null on any failure (invalid token → the caller
  // silently starts fresh per design).
  hydrate: () => Promise<DraftResumeState | null>;
}

export function useRegistrationDraft(eventId: string): UseRegistrationDraftResult {
  // Mirror in a ref so getToken works during render-adjacent callbacks
  // without re-reading storage every time.
  const tokenRef = useRef<string | null | undefined>(undefined);

  const getToken = useCallback((): string | null => {
    if (tokenRef.current === undefined) {
      tokenRef.current = typeof window === "undefined" ? null : readToken(eventId);
    }
    return tokenRef.current;
  }, [eventId]);

  const saveToken = useCallback(
    (token: string) => {
      tokenRef.current = token;
      try {
        window.sessionStorage.setItem(storageKey(eventId), token);
      } catch {
        // Best-effort persistence only.
      }
    },
    [eventId],
  );

  const clearToken = useCallback(() => {
    tokenRef.current = null;
    try {
      window.sessionStorage.removeItem(storageKey(eventId));
    } catch {
      // Ignore.
    }
  }, [eventId]);

  const hydrate = useCallback(async (): Promise<DraftResumeState | null> => {
    const token = getToken();
    if (!token) return null;

    try {
      const response = await fetch(`/api/events/${eventId}/registration/draft`, {
        method: "GET",
        headers: { "x-draft-token": token },
      });
      if (!response.ok) {
        // Invalid/expired token → clear and start fresh, silently.
        clearToken();
        return null;
      }
      return (await response.json()) as DraftResumeState;
    } catch {
      return null;
    }
  }, [eventId, getToken, clearToken]);

  return { getToken, saveToken, clearToken, hydrate };
}
