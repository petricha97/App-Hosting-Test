// Dashboard scanner shortcut (M5-T5 AC-8): the SAME scanner surface as the
// public door scanner, rendered inside the dashboard shell and authenticated
// by the admin session — its resolve/confirm calls hit the write:events-
// gated dashboard routes and record checkedInBy { kind: "admin", userId }.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScannerSurface } from "@/features/checkin/components/scanner-surface";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";

export const metadata: Metadata = {
  title: "Scanner | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function DashboardScanPage({ params }: PageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(
    eventId,
    scope.organizationId,
  );

  if (!event) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Scanner</h1>
          <p className="text-sm text-muted-foreground">
            Scan attendee passes for {event.name}.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/dashboard/events/${encodeURIComponent(eventId)}/checkin`}>
            <ArrowLeft aria-hidden="true" />
            Back to check-in
          </Link>
        </Button>
      </div>

      <ScannerSurface eventId={eventId} mode={{ kind: "admin" }} />
    </div>
  );
}
