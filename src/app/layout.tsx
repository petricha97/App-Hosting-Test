import type { Metadata } from "next";

import "./globals.css";
import { Header } from "./components";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import ChatSupport from "@/components/chat/ChatSupport";

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
          <Header />
          {children}
          <Toaster />
          <ChatSupport />
        </AuthProvider>
      </body>
    </html>
  );
}
