import type { Metadata } from "next";

import { ComingSoonSection } from "@/features/event/components/coming-soon";

export const metadata: Metadata = {
  title: "Pricing | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventPricingPage({ params }: PageProps) {
  const { eventId } = await params;

  return <ComingSoonSection segment="pricing" eventId={eventId} />;
}
