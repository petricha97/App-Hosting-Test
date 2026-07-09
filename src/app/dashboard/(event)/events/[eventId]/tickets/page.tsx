import type { Metadata } from "next";

import { ComingSoonSection } from "@/features/event/components/coming-soon";

export const metadata: Metadata = {
  title: "Ticket Types | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventTicketTypesPage({ params }: PageProps) {
  const { eventId } = await params;

  return <ComingSoonSection segment="tickets" eventId={eventId} />;
}
