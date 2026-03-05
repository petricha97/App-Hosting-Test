"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";

import { Arrow } from "./Arrow";
import { Firebase } from "./Firebase";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

export function Header() {
  const pathname = usePathname();
  const router = useRouter();

  const { user } = useAuth();

  async function handleLogout() {
    await signOut(auth);

    // clear server session cookie
    await fetch("/api/auth/session", { method: "DELETE" });

    router.push("/");
  }

  return (
    <>
      {pathname !== "/" && (
        <Link className="button back-button" href="/">
          <Arrow /> Back to home
        </Link>
      )}

      <header className="header">
        <Firebase />
      </header>

      <div
        style={{
          position: "fixed",
          top: "32px",
          right: "32px",
        }}
      >
        {user ? (
          <button
            onClick={handleLogout}
            className="button"
            style={{
              background: "var(--button)",
              color: "var(--primary-contrast)",
            }}
          >
            Logout
          </button>
        ) : (
          pathname !== "/login" &&
          pathname !== "/signup" && (
            <Link
              href="/login"
              className="button"
              style={{
                background: "var(--button)",
                color: "var(--primary-contrast)",
                textDecoration: "none",
              }}
            >
              Login
            </Link>
          )
        )}
      </div>
    </>
  );
}