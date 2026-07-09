import type { Metadata } from "next";

import { ComingSoonSection } from "@/features/event/components/coming-soon";

export const metadata: Metadata = {
  title: "Emails | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventEmailsPage({ params }: PageProps) {
  const { eventId } = await params;

  return <ComingSoonSection segment="emails" eventId={eventId} />;
}
