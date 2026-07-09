import type { Metadata } from "next";

import { ComingSoonSection } from "@/features/event/components/coming-soon";

export const metadata: Metadata = {
  title: "Registration Paths | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventRegistrationPathsPage({ params }: PageProps) {
  const { eventId } = await params;

  return <ComingSoonSection segment="registration-paths" eventId={eventId} />;
}
