import type { Metadata } from "next";

import { ComingSoonSection } from "@/features/event/components/coming-soon";

export const metadata: Metadata = {
  title: "Attendees | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventAttendeesPage({ params }: PageProps) {
  const { eventId } = await params;

  return <ComingSoonSection segment="attendees" eventId={eventId} />;
}
