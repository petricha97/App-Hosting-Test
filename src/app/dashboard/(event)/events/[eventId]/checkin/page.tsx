// Check-in configuration screen (M5-T4). Server Component: verifies org
// ownership (404 cross-org), reads the stat-card aggregate counts, the lazy
// config (read-time defaults, zero writes), the active team members and the
// first accepted attendee for the badge preview (real deterministic QR SVG),
// then renders the client workspace.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";

import {
  SAMPLE_BADGE,
  type BadgeSample,
} from "@/features/checkin/components/badge-preview-card";
import { CheckinLoadError } from "@/features/checkin/components/checkin-load-error";
import { CheckinWorkspace } from "@/features/checkin/components/checkin-workspace";
import type { CheckinSettings } from "@/features/checkin/settings";
import {
  isEventStartInFuture,
  serializeActiveTeamMembers,
  type SerializedTeamMember,
} from "@/features/checkin/utils";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import {
  countAdminAttendeesForEvent,
  listAdminAttendeesForEvent,
} from "@/lib/db/adminAttendee";
import { getAdminCheckinConfigForEvent } from "@/lib/db/adminCheckinConfig";
import { listAdminCheckinTeamMembersForEvent } from "@/lib/db/adminCheckinTeamMember";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { mintQrToken } from "@/lib/qr/qr-token";
import type { AttendeeDoc, WithId } from "@/types/collection";

export const metadata: Metadata = {
  title: "Check-in | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

// Live badge sample from the first accepted attendee (T4 AC-2): merge-field
// denorms + the attendee's REAL deterministic QR (re-minted here — the raw
// token is never stored). Zero attendees -> the sample placeholder.
async function buildBadgeSample(
  eventId: string,
  first: WithId<AttendeeDoc> | undefined,
): Promise<BadgeSample> {
  if (!first) return SAMPLE_BADGE;

  const fullName = [first.firstName, first.lastName]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const qrToken = mintQrToken({ eventId, formDataId: first.submissionId });
  const qrSvg = await QRCode.toString(qrToken, { type: "svg", margin: 0 });

  return {
    fullName: fullName || first.email || "Unnamed attendee",
    jobTitle: first.jobTitle ?? "",
    company: first.company ?? "",
    registrationTypeLabel: first.registrationTypeLabel || "—",
    qrSvg,
  };
}

export default async function EventCheckinPage({ params }: PageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(
    eventId,
    scope.organizationId,
  );

  if (!event) {
    notFound();
  }

  let checkedInCount = 0;
  let expectedCount = 0;
  let settings: CheckinSettings;
  let teamMembers: SerializedTeamMember[] = [];
  let badgeSample: BadgeSample = SAMPLE_BADGE;
  try {
    const [checkedIn, accepted, config, members, firstAttendees] =
      await Promise.all([
        countAdminAttendeesForEvent({
          eventId,
          organizationId: scope.organizationId,
          checkInState: "checked-in",
        }),
        countAdminAttendeesForEvent({
          eventId,
          organizationId: scope.organizationId,
          status: "accepted",
        }),
        getAdminCheckinConfigForEvent({
          eventId,
          organizationId: scope.organizationId,
        }),
        listAdminCheckinTeamMembersForEvent({
          eventId,
          organizationId: scope.organizationId,
        }),
        listAdminAttendeesForEvent({
          eventId,
          organizationId: scope.organizationId,
          status: "accepted",
          limit: 1,
        }),
      ]);

    checkedInCount = checkedIn;
    expectedCount = accepted;
    settings = config;
    teamMembers = serializeActiveTeamMembers(members);
    badgeSample = await buildBadgeSample(eventId, firstAttendees[0]);
  } catch {
    // The page-level retry panel (design §3) — counts/config/members share
    // one load, so a partial render would lie about the event's state.
    return <CheckinLoadError />;
  }

  return (
    <CheckinWorkspace
      eventId={eventId}
      checkedInCount={checkedInCount}
      expectedCount={expectedCount}
      eventStartInFuture={isEventStartInFuture(event)}
      badgeSample={badgeSample}
      settings={settings}
      teamMembers={teamMembers}
    />
  );
}
