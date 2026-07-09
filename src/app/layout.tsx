import type { Metadata } from "next";

import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { SiteHeader } from "@/components/layout/site-header";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Eventa | Event management made simple",
  description: "Create, publish, and discover events in one simple workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          <SiteHeader />
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
