"use client";

// Client-driven state machine for /invite/[token] (M8-T1 spec §4). Owns the
// one call to POST /api/organizations/invitations/accept and every state it
// can return, for BOTH acceptance paths:
//   - an already-authenticated visitor (was already signed in, or just
//     signed in via the embedded LoginForm)
//   - a brand-new user, who is routed here by organization-form.tsx AFTER
//     creating their Firebase Auth account (D7: "sign up first... then
//     accept" — this page performs the actual accept call either way, so
//     there is exactly one place that interprets the API's result).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { LoginForm } from "@/components/auth/login-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AcceptInvitationViewProps {
  token: string;
}

type AcceptStatus =
  | "checking-auth"
  | "signed-out"
  | "accepting"
  | "success"
  | "email-mismatch"
  | "invalid"
  | "error";

interface AcceptErrorBody {
  error?: string;
}

// Syncs the httpOnly session cookie dashboard SSR routes require
// (requireSessionUser, src/lib/session.ts) — same POST /api/auth/session
// call login-form.tsx already makes after email/password sign-in. Needed
// here too because acceptance can happen purely via the client Firebase SDK
// (a brand-new signup, or a Bearer-only mid-signup caller) with no session
// cookie minted yet, and the redirect straight into /dashboard depends on it.
async function syncSessionCookie(idToken: string): Promise<void> {
  try {
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: idToken }),
    });
  } catch {
    // Non-fatal — the next explicit login mints the cookie anyway, and the
    // acceptance itself already succeeded.
  }
}

export function AcceptInvitationView({ token }: AcceptInvitationViewProps) {
  const router = useRouter();
  const { user, initializing, signOut } = useAuth();
  const [status, setStatus] = useState<AcceptStatus>("checking-auth");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Keyed by token+uid (not a lifetime boolean) so a caller who signs out
  // and signs back in as a DIFFERENT account (e.g. the "Sign out & try
  // again" CTA on the email-mismatch screen) gets a fresh accept attempt
  // for their new identity, without requiring a full page remount.
  const attemptedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (initializing) {
      setStatus("checking-auth");
      return;
    }

    if (!user) {
      setStatus("signed-out");
      attemptedForRef.current = null;
      return;
    }

    const attemptKey = `${token}:${user.uid}`;
    if (attemptedForRef.current === attemptKey) return;
    attemptedForRef.current = attemptKey;

    let cancelled = false;

    (async () => {
      setStatus("accepting");
      try {
        const idToken = await user.getIdToken();
        const response = await fetch("/api/organizations/invitations/accept", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            token,
            displayName: user.displayName ?? undefined,
          }),
        });

        if (cancelled) return;

        if (response.ok) {
          await syncSessionCookie(idToken);
          if (cancelled) return;
          setStatus("success");
          toast.success("You've joined the workspace.");
          window.setTimeout(() => {
            if (!cancelled) router.push("/dashboard");
          }, 1200);
          return;
        }

        const data = (await response
          .json()
          .catch(() => null)) as AcceptErrorBody | null;

        if (response.status === 403) {
          setStatus("email-mismatch");
          return;
        }

        setStatus("invalid");
        setErrorMessage(typeof data?.error === "string" ? data.error : null);
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // router is intentionally excluded: Next's real useRouter() instance is
    // stable across renders, but re-including it here would re-run (and
    // cancel) this effect on every state update this same effect causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializing, user, token]);

  const handleSignOutAndRetry = async () => {
    await signOut();
    router.push("/login");
  };

  if (status === "checking-auth" || status === "accepting") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Loader2
              aria-hidden="true"
              className="h-8 w-8 animate-spin text-muted-foreground"
            />
          </div>
          <CardTitle>
            {status === "accepting"
              ? "Accepting invitation..."
              : "Checking your account..."}
          </CardTitle>
          <CardDescription>This will only take a moment.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (status === "signed-out") {
    return (
      <div className="w-full max-w-md space-y-6">
        <Card>
          <CardHeader className="text-center">
            <CardTitle>You&apos;ve been invited</CardTitle>
            <CardDescription>
              Sign in to accept the invitation, or create an account if
              you&apos;re new here.
            </CardDescription>
          </CardHeader>
        </Card>

        <LoginForm redirectTo={`/invite/${token}`} />

        <p className="text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link
            href={`/signup?inviteToken=${encodeURIComponent(token)}`}
            className="underline underline-offset-4"
          >
            Create an account
          </Link>
        </p>
      </div>
    );
  }

  if (status === "success") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-green-100 p-3">
              <CheckCircle2
                aria-hidden="true"
                className="h-8 w-8 text-green-600"
              />
            </div>
          </div>
          <CardTitle>You&apos;re in!</CardTitle>
          <CardDescription>Taking you to your dashboard...</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => router.push("/dashboard")}>
            Go to Dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === "email-mismatch") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-destructive/10 p-3">
              <XCircle
                aria-hidden="true"
                className="h-8 w-8 text-destructive"
              />
            </div>
          </div>
          <CardTitle>Wrong account</CardTitle>
          <CardDescription>
            This invitation was sent to a different email address than the
            account you&apos;re signed in with. Sign out and sign in with the
            invited email address to accept it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void handleSignOutAndRetry()}
          >
            Sign out & try again
          </Button>
          <Button variant="ghost" className="w-full" asChild>
            <Link href="/">Back to home</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // status === "invalid" | "error"
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="rounded-full bg-muted p-3">
            <XCircle
              aria-hidden="true"
              className="h-8 w-8 text-muted-foreground"
            />
          </div>
        </div>
        <CardTitle>This invitation is no longer valid</CardTitle>
        <CardDescription>
          {status === "error"
            ? "Something went wrong while accepting this invitation. Please try again."
            : (errorMessage ??
              "It may have expired, been revoked, or already been used. Ask whoever invited you to send a new one.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button variant="outline" className="w-full" asChild>
          <Link href={user ? "/dashboard" : "/login"}>
            {user ? "Go to your dashboard" : "Sign in"}
          </Link>
        </Button>
        <Button variant="ghost" className="w-full" asChild>
          <Link href="/">Back to home</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
