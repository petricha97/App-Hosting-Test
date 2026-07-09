import type { Metadata } from "next";

import { ComingSoonSection } from "@/features/event/components/coming-soon";

export const metadata: Metadata = {
  title: "Check-in | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventCheckinPage({ params }: PageProps) {
  const { eventId } = await params;

  return <ComingSoonSection segment="checkin" eventId={eventId} />;
}
