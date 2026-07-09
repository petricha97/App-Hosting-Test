import type { Metadata } from "next";

import { ComingSoonSection } from "@/features/event/components/coming-soon";

export const metadata: Metadata = {
  title: "Reports | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventReportsPage({ params }: PageProps) {
  const { eventId } = await params;

  return <ComingSoonSection segment="reports" eventId={eventId} />;
}
