import type { ReactNode } from "react";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import decodeUser from "@/lib/auth-utils";
import { DashboardShell } from "@/features/dashboard/components/dashboard-shell";

const COOKIE_NAME = "session";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    redirect("/login");
  }

  const user = await decodeUser(token);

  if ("error" in user) {
    if (user.error === "USER_DISABLED") {
      redirect("/disabled");
    }

    if (user.error === "TOKEN_EXPIRED") {
      redirect("/login");
    }

    redirect("/login");
  }

  return (
    <DashboardShell
      serverUser={{
        name: user.name,
        email: user.email,
        picture: user.picture,
      }}
    >
      {children}
    </DashboardShell>
  );
}
