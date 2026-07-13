"use client";

// Public scanner access-code gate (M5-T5 AC-1/AC-2, design §4): centered
// card, monospace one-time-code input, full-width h-12 "Start scanning".
// Wrong/revoked/unknown codes all render the SAME generic error (no oracle);
// 429 gets the wait-a-minute copy. The exchanged session token is handed up
// to the page shell (sessionStorage) — never a URL.

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AccessCodeGateProps {
  eventId: string;
  // e.g. "Session expired — enter your code again." after a mid-shift 401.
  notice: string | null;
  onSession: (session: { token: string; memberName: string }) => void;
}

export function AccessCodeGate({
  eventId,
  notice,
  onSession,
}: AccessCodeGateProps) {
  const [accessCode, setAccessCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (accessCode.trim().length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/checkin/session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessCode: accessCode.trim() }),
        },
      );

      if (response.status === 429) {
        setError("Too many attempts — wait a minute.");
        return;
      }
      if (!response.ok) {
        setError("That code didn't work. Check with the event organizer.");
        return;
      }

      const data = (await response.json()) as {
        token: string;
        memberName: string;
      };
      onSession({ token: data.token, memberName: data.memberName });
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>Scanner access</CardTitle>
        <CardDescription>
          Enter the access code your event organizer gave you.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {notice ? (
            <p
              role="status"
              className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              {notice}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="scanner-access-code" className="sr-only">
              Access code
            </Label>
            <Input
              id="scanner-access-code"
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              className="h-12 text-center font-mono text-lg tracking-widest"
              maxLength={128}
              disabled={submitting}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            className="h-12 w-full"
            disabled={submitting || accessCode.trim().length === 0}
          >
            {submitting ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            Start scanning
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
