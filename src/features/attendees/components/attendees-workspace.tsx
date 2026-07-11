"use client";

// Attendees screen shell (M5-T2/T3, design §1): h1 + muted sub, Radix Tabs
// ("Attendee list" / "Abandoned") with ?tab= URL sync via router.replace —
// tab switches are view state, not history entries. The abandoned trigger
// carries a small amber count chip when > 0; abandoned rows live here so a
// row delete decrements the chip immediately.

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SerializedAbandonedDraft } from "@/features/attendees/abandoned";
import { AbandonedTab } from "@/features/attendees/components/abandoned-tab";
import { AttendeeListTab } from "@/features/attendees/components/attendee-list-tab";
import type { SerializedAttendeeRow } from "@/features/attendees/roster";
import { resolveAttendeesTab, type AttendeesTab } from "@/features/attendees/utils";
import type { FormFieldValues } from "@/features/form/schema";
import type { SerializedRegistrationPath } from "@/features/registration-paths/types";
import type {
  SerializedRegistrationType,
  SerializedTicketType,
} from "@/features/registration/types";

interface AttendeesWorkspaceProps {
  eventId: string;
  initialTab: AttendeesTab;
  acceptedCount: number;
  initialRows: SerializedAttendeeRow[];
  initialAttendeeCursorMs: number | null;
  initialPendingCursorMs: number | null;
  initialHasMoreAttendees: boolean;
  initialHasMorePending: boolean;
  abandonedDrafts: SerializedAbandonedDraft[];
  paths: SerializedRegistrationPath[];
  tickets: SerializedTicketType[];
  registrationTypes: SerializedRegistrationType[];
  questionFields: FormFieldValues[];
  hasForm: boolean;
  loadError: boolean;
}

export function AttendeesWorkspace({
  eventId,
  initialTab,
  acceptedCount,
  initialRows,
  initialAttendeeCursorMs,
  initialPendingCursorMs,
  initialHasMoreAttendees,
  initialHasMorePending,
  abandonedDrafts,
  paths,
  tickets,
  registrationTypes,
  questionFields,
  hasForm,
  loadError,
}: AttendeesWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<AttendeesTab>(initialTab);
  const [drafts, setDrafts] = useState(abandonedDrafts);

  const handleTabChange = (value: string) => {
    const next = resolveAttendeesTab(value);
    setTab(next);
    // replace (not push): tab switches are view state, not history entries.
    router.replace(`${pathname}?tab=${next}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Attendees</h1>
        <p className="text-sm text-muted-foreground">
          The confirmed roster, pre-accept registrations and abandoned
          check-outs for this event.
        </p>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange} className="gap-6">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="list">Attendee list</TabsTrigger>
          <TabsTrigger value="abandoned">
            Abandoned
            {drafts.length > 0 ? (
              <Badge className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-amber-900 tabular-nums dark:bg-amber-950 dark:text-amber-200">
                {drafts.length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <AttendeeListTab
            eventId={eventId}
            acceptedCount={acceptedCount}
            initialRows={initialRows}
            initialAttendeeCursorMs={initialAttendeeCursorMs}
            initialPendingCursorMs={initialPendingCursorMs}
            initialHasMoreAttendees={initialHasMoreAttendees}
            initialHasMorePending={initialHasMorePending}
            paths={paths}
            tickets={tickets}
            registrationTypes={registrationTypes}
            questionFields={questionFields}
            hasForm={hasForm}
            loadError={loadError}
          />
        </TabsContent>
        <TabsContent value="abandoned">
          <AbandonedTab
            eventId={eventId}
            drafts={drafts}
            onDraftsChange={setDrafts}
            loadError={loadError}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
