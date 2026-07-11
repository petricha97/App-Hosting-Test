// Pure check-in screen helpers (M5-T4). No Firebase imports — shared by the
// server page and unit tests.

import { timestampToIso } from "@/features/attendees/roster";
import type { CheckinTeamMemberDoc, EventDoc, WithId } from "@/types/collection";

// "event not started" caption rule (spec T4 AC-1): shown only when the
// checked-in count is 0 AND the event start is in the future. Start dates
// resolve through the same tolerant period keys the event-bar helpers use
// (date/start/startDate + startTime/start_time — legacy spellings). When no
// period has a parseable date we cannot prove the event hasn't started, so
// the caption stays hidden (fail-quiet).
export function isEventStartInFuture(
  event: Pick<EventDoc, "periods">,
  now: Date = new Date(),
): boolean {
  const starts: number[] = [];

  for (const period of event.periods ?? []) {
    const date = period.date ?? period.start ?? period.startDate ?? null;
    if (!date) continue;
    const time = period.startTime ?? period.start_time ?? "00:00";
    const parsed = new Date(`${date}T${time}`);
    if (!Number.isNaN(parsed.getTime())) starts.push(parsed.getTime());
  }

  if (starts.length === 0) return false;
  return Math.min(...starts) > now.getTime();
}

// Team-member row shape for the client card. NO accessCodeHash — code
// material never leaves the server, and revoked members are dropped before
// serialization (design §3 prefers removal over struck-through rows).
export interface SerializedTeamMember {
  id: string;
  name: string;
  deviceLabel: string;
  // null renders "Never used".
  lastSeenAtIso: string | null;
}

export function serializeTeamMember(
  doc: WithId<CheckinTeamMemberDoc>,
): SerializedTeamMember {
  return {
    id: doc.id,
    name: doc.name,
    deviceLabel: doc.deviceLabel,
    lastSeenAtIso: timestampToIso(doc.lastSeenAt),
  };
}

export function serializeActiveTeamMembers(
  docs: WithId<CheckinTeamMemberDoc>[],
): SerializedTeamMember[] {
  return docs.filter((doc) => doc.isActive).map(serializeTeamMember);
}
