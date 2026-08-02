"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { auth } from "@/lib/firebase";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { loginSchema, LoginValues } from "@/lib/validation";
import { JoinOrganizationDialog } from "@/components/auth/join-organization-dialog";

export interface LoginFormProps extends React.ComponentProps<"div"> {
  redirectTo?: string;
  redirectDelaySec?: number;
}

export function LoginForm({
  className,
  redirectTo = "/dashboard",
  redirectDelaySec = 5,
  ...props
}: LoginFormProps) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [countdown, setCountdown] = useState<number>(redirectDelaySec);
  const [sessionReady, setSessionReady] = useState(false);
  const [syncingSession, setSyncingSession] = useState(false);
  const timerRef = useRef<number | null>(null);
  const syncedUserIdRef = useRef<string | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: "onChange",
    defaultValues: { email: "", password: "" },
  });

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isValid },
  } = form;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user ?? null);
      if (user) {
        setCountdown(redirectDelaySec);
        setSessionReady(false);
      } else {
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        syncedUserIdRef.current = null;
        setSessionReady(false);
        setSyncingSession(false);
      }
    });
    return () => {
      unsub();
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [redirectDelaySec]);

  useEffect(() => {
    if (!currentUser || !sessionReady) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (timerRef.current) return;
    timerRef.current = window.setInterval(() => {
      setCountdown((s) => {
        if (s <= 1) {
          if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000) as unknown as number;
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [currentUser, sessionReady]);

  useEffect(() => {
    if (countdown === 0 && currentUser && sessionReady) {
      router.replace(redirectTo);
    }
  }, [countdown, currentUser, redirectTo, router, sessionReady]);

  const mapFirebaseError = (err: FirebaseError): void => {
    switch (err.code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        setError("password", { message: "Invalid email or password." });
        break;
      case "auth/too-many-requests":
        setError("root", {
          message: "Too many attempts. Please try again later.",
        });
        break;
      default:
        setError("root", { message: "Login failed. Please try again." });
    }
  };

  async function syncSessionCookie(forceRefresh = false) {
    const user = auth.currentUser;
    if (!user) return;

    const token = await user.getIdToken(forceRefresh);

    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      throw new Error("Failed to restore the server session.");
    }
  }

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    if (syncedUserIdRef.current === currentUser.uid) {
      setSessionReady(true);
      return;
    }

    const currentUserId = currentUser.uid;
    let cancelled = false;

    async function ensureServerSession() {
      setSyncingSession(true);
      try {
        await syncSessionCookie(true);

        if (cancelled) {
          return;
        }

        syncedUserIdRef.current = currentUserId;
        setSessionReady(true);
        setCountdown(redirectDelaySec);
      } catch (error) {
        console.error(error);

        if (cancelled) {
          return;
        }

        setSessionReady(false);
        setError("root", {
          message: "Could not restore your dashboard session. Try again.",
        });
      } finally {
        if (!cancelled) {
          setSyncingSession(false);
        }
      }
    }

    void ensureServerSession();

    return () => {
      cancelled = true;
    };
  }, [currentUser, redirectDelaySec, setError]);

  const onSubmit: SubmitHandler<LoginValues> = async (values) => {
    try {
      await signInWithEmailAndPassword(auth, values.email, values.password);
      await syncSessionCookie(true);
      syncedUserIdRef.current = auth.currentUser?.uid ?? null;
      setSessionReady(true);
      router.replace(redirectTo);
    } catch (e) {
      if (e instanceof FirebaseError) mapFirebaseError(e);
      else setError("root", { message: "Unexpected error. Please try again." });
    }
  };

  const loginWithGoogle = async (): Promise<void> => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      await syncSessionCookie(true);
      syncedUserIdRef.current = auth.currentUser?.uid ?? null;
      setSessionReady(true);
      router.replace(redirectTo);
    } catch {
      setError("root", { message: "Google sign in failed. Please try again." });
    }
  };

  const handleLogout = async (): Promise<void> => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    await signOut(auth);
    await fetch("/api/auth/session", { method: "DELETE" });
    syncedUserIdRef.current = null;
    setCurrentUser(null);
    setSessionReady(false);
  };

  if (currentUser) {
    return (
      <Card className={cn(className)} {...props}>
        <CardHeader>
          <CardTitle>You&apos;re already logged in</CardTitle>
          <CardDescription>
            Redirecting to your dashboard in{" "}
            <span aria-live="polite" className="font-medium">
              {countdown}
            </span>{" "}
            seconds…
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <Button onClick={() => router.push(redirectTo)} className="w-1/2">
              Go now
            </Button>
            <Button variant="outline" onClick={handleLogout} className="w-1/2">
              Log out
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Login to your account</CardTitle>
          <CardDescription>Enter your email and password.</CardDescription>
        </CardHeader>

        <CardContent>
          <Form {...form}>
            <form
              onSubmit={handleSubmit(onSubmit)}
              noValidate
              className="space-y-6"
            >
              {errors.root?.message && (
                <p className="text-sm text-red-600" role="alert">
                  {errors.root.message}
                </p>
              )}

              <FormField
                control={control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Password</FormLabel>
                      <Link
                        href="/forgot-password"
                        className="text-sm underline-offset-4 hover:underline"
                      >
                        Forgot your password?
                      </Link>
                    </div>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-3">
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!isValid || isSubmitting}
                >
                  {isSubmitting ? "Signing in..." : "Login"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={loginWithGoogle}
                  disabled={isSubmitting}
                >
                  Continue with Google
                </Button>
              </div>

              <div className="mt-2 text-center text-sm">
                Don&apos;t have an account?{" "}
                <Link href="/signup" className="underline underline-offset-4">
                  Sign up
                </Link>
              </div>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    Or
                  </span>
                </div>
              </div>

              <div className="text-center">
                <JoinOrganizationDialog />
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
