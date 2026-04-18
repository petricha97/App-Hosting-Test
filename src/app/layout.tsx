import type { Metadata } from "next";

import "./globals.css";
import { Header } from "./components";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import ChatSupport from "@/components/chat/ChatSupport";

export const metadata: Metadata = {
  title: "Next.js on Firebase App Hosting",
  description: "",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark-theme dark">
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          <div className="dots" />
          <Header />
          {children}
          <div className="bottom-gradient" />
          <Toaster />
          <ChatSupport />
        </AuthProvider>
      </body>
    </html>
  );
}
