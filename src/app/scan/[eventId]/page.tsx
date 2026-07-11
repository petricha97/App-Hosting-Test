// Public door-scanner page (M5-T5): /scan/[eventId] — standalone, mobile-
// first, NO dashboard chrome. Access is capability-based: the page renders
// for any published event, but nothing works without a valid access code
// (exchanged for a signed scanner session by the API). Unknown/unpublished
// events 404 — indistinguishable from missing.
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicScannerPage } from "@/features/checkin/components/public-scanner-page";
import { getAdminPublishedEventById } from "@/lib/db/adminEvent";

export const metadata: Metadata = {
  title: "Check-in scanner | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function ScanPage({ params }: PageProps) {
  const { eventId } = await params;

  const event = await getAdminPublishedEventById(eventId);
  if (!event) notFound();

  return <PublicScannerPage eventId={eventId} eventName={event.name} />;
}
