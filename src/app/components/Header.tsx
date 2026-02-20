"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Arrow } from "./Arrow";
import { Firebase } from "./Firebase";

export function Header() {
  const pathname = usePathname();

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

      {pathname !== "/login" && pathname !== "/signup" && (
        <Link
          href="/login"
          className="button"
          style={{
            position: "fixed",
            top: "32px",
            right: "32px",
            background: "var(--button)",
            color: "var(--primary-contrast)",
            textDecoration: "none",
          }}
        >
          Login
        </Link>
      )}
    </>
  );
}
