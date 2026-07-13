"use client";

// Service Fees tab (M2-T3): designed empty state ONLY — no CTA, no entity,
// no API, no network calls. Service-fee charging is a later milestone.
import { CreditCard } from "lucide-react";

import { EntityEmptyState } from "@/features/registration/components/entity-table-states";

export function ServiceFeesTab() {
  return (
    <EntityEmptyState
      icon={CreditCard}
      title="No service fees configured"
      description="Add a per-order processing fee if you pass card costs on to attendees. Coming in a later milestone."
    />
  );
}
