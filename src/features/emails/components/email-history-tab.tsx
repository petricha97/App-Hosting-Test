"use client";

// Per-definition History tab inside the editor dialog (design §3) — reuses
// send-log-table.tsx wholesale, kind LOCKED (no kind selector, status filter
// still available), no page-level count-badge chrome ("one table
// implementation, not two").
import { useEffect, useState } from "react";

import { SendLogTable } from "@/features/emails/components/send-log-table";
import type {
  SerializedEmailDefinition,
  SerializedEmailMessage,
} from "@/features/emails/types";

interface EmailHistoryTabProps {
  eventId: string;
  kind: string;
  definitionsByKind: Map<string, SerializedEmailDefinition>;
}

export function EmailHistoryTab({
  eventId,
  kind,
  definitionsByKind,
}: EmailHistoryTabProps) {
  const [initial, setInitial] = useState<{
    messages: SerializedEmailMessage[];
    count: number;
    nextCursor: number | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInitial(null);
    fetch(
      `/api/dashboard/events/${encodeURIComponent(eventId)}/emails/messages?kind=${encodeURIComponent(kind)}`,
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) {
          setInitial(data ?? { messages: [], count: 0, nextCursor: null });
        }
      })
      .catch(() => {
        if (!cancelled)
          setInitial({ messages: [], count: 0, nextCursor: null });
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, kind]);

  if (!initial) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-8 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <SendLogTable
      key={kind}
      eventId={eventId}
      definitionsByKind={definitionsByKind}
      initialMessages={initial.messages}
      initialCount={initial.count}
      initialNextCursor={initial.nextCursor}
      lockedKind={kind}
      compact
    />
  );
}
