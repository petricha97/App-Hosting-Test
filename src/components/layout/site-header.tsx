"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";

import { ArrowLeft } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { auth } from "@/lib/firebase";

function BrandMark() {
  return (
    <Link
      href="/"
      className="flex items-center gap-3 text-sm font-semibold tracking-tight text-slate-950"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ffb082,#ff7a59)] text-sm text-white shadow-sm">
        E
      </span>
      <span className="text-base">Eventa</span>
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const isHomeRoute = pathname === "/";
  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/invite");

  const { user, initializing } = useAuth();

  async function handleLogout() {
    await signOut(auth);
    await fetch("/api/auth/session", { method: "DELETE" });
    router.push("/");
  }

  if (isDashboardRoute) {
    return null;
  }

  if (isHomeRoute) {
    return (
      <header className="fixed inset-x-0 top-0 z-40 px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-4 rounded-full border border-orange-100/70 bg-white/85 px-4 py-3 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.35)] backdrop-blur supports-[backdrop-filter]:bg-white/80 sm:px-6 lg:px-8 2xl:max-w-[1760px]">
          <BrandMark />

          <nav className="hidden items-center gap-6 text-sm text-slate-600 md:flex">
            <Link href="#features" className="transition hover:text-slate-950">
              Product
            </Link>
            <Link href="/events" className="transition hover:text-slate-950">
              Events
            </Link>
            <Link
              href="#organizers"
              className="transition hover:text-slate-950"
            >
              Organizers
            </Link>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {!initializing && user ? (
              <>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-full border border-orange-200 px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-orange-300 hover:bg-orange-50"
                >
                  Dashboard
                </Link>
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center justify-center rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                  type="button"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-full border border-orange-200 px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-orange-300 hover:bg-orange-50"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-full bg-[#ff7a59] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#f46a47]"
                >
                  Create event
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 px-4 py-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 rounded-full border border-slate-200/80 bg-white/90 px-4 py-3 shadow-sm backdrop-blur sm:px-5">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Home</span>
          </Link>
          <BrandMark />
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/events"
            className="hidden rounded-full border border-orange-200 px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-orange-300 hover:bg-orange-50 sm:inline-flex"
          >
            Events
          </Link>
          {!initializing && user ? (
            <>
              <span className="hidden text-sm text-slate-500 sm:inline">
                {user.displayName}
              </span>
              <button
                onClick={handleLogout}
                className="inline-flex items-center justify-center rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                type="button"
              >
                Log out
              </button>
            </>
          ) : (
            !isAuthRoute && (
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Log in
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  );
}
