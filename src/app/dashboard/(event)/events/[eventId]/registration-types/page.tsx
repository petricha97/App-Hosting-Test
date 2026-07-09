import type { Metadata } from "next";

import { ComingSoonSection } from "@/features/event/components/coming-soon";

export const metadata: Metadata = {
  title: "Registration Types | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventRegistrationTypesPage({ params }: PageProps) {
  const { eventId } = await params;

  return <ComingSoonSection segment="registration-types" eventId={eventId} />;
}
