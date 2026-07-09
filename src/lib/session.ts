/// <reference types="react/canary" />

import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import decodeUser from "@/lib/auth-utils";

const COOKIE_NAME = "session";

// Reads the session cookie and verifies the Firebase ID token. Wrapped in
// React cache() so verifyIdToken runs at most once per request, no matter how
// many nested layouts/pages/scopes call the gate. Returns null when no cookie
// is present; callers decide what to do (requireSessionUser redirects).
const getSessionUser = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return decodeUser(token);
});

// The single home for the dashboard session policy: missing or invalid token
// redirects to /login, disabled accounts redirect to /disabled. Returns the
// decoded user on success.
export async function requireSessionUser() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  if ("error" in user) {
    if (user.error === "USER_DISABLED") {
      redirect("/disabled");
    }

    redirect("/login");
  }

  return user;
}
