"use client";

// Event-wide Send log tab (design §5) — wraps send-log-table.tsx with no
// definition filter and mirrors filter changes into the URL (?status=/
// ?kind=), matching the M3 responses-toolbar precedent.
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SendLogTable } from "@/features/emails/components/send-log-table";
import type {
  SerializedEmailDefinition,
  SerializedEmailMessage,
} from "@/features/emails/types";

interface SendLogTabProps {
  eventId: string;
  definitions: SerializedEmailDefinition[];
  definitionsByKind: Map<string, SerializedEmailDefinition>;
  initialMessages: SerializedEmailMessage[];
  initialCount: number;
  initialNextCursor: number | null;
}

export function SendLogTab({
  eventId,
  definitions,
  definitionsByKind,
  initialMessages,
  initialCount,
  initialNextCursor,
}: SendLogTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const kindOptions = definitions.map((definition) => ({
    value: definition.kind,
    label: definition.name,
  }));

  const handleFilterChange = (filters: { status: string; kind: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "log");
    if (filters.status !== "all") {
      params.set("status", filters.status);
      params.delete("kind");
    } else if (filters.kind !== "all") {
      params.set("kind", filters.kind);
      params.delete("status");
    } else {
      params.delete("status");
      params.delete("kind");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <SendLogTable
      eventId={eventId}
      definitionsByKind={definitionsByKind}
      initialMessages={initialMessages}
      initialCount={initialCount}
      initialNextCursor={initialNextCursor}
      kindOptions={kindOptions}
      onFilterChange={handleFilterChange}
    />
  );
}
