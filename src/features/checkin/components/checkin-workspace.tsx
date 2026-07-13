"use client";

// Check-in screen shell (M5-T4, design §3): header row with the primary
// "Open scanner" shortcut (dashboard scanner, admin session), the stat row,
// then badge preview | settings + team members (stacking below lg).

import Link from "next/link";
import { ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  BadgePreviewCard,
  type BadgeSample,
} from "@/features/checkin/components/badge-preview-card";
import { CheckinSettingsCard } from "@/features/checkin/components/checkin-settings-card";
import { CheckinStatCards } from "@/features/checkin/components/checkin-stat-cards";
import { TeamMembersCard } from "@/features/checkin/components/team-members-card";
import type { CheckinSettings } from "@/features/checkin/settings";
import type { SerializedTeamMember } from "@/features/checkin/utils";

interface CheckinWorkspaceProps {
  eventId: string;
  checkedInCount: number;
  expectedCount: number;
  eventStartInFuture: boolean;
  badgeSample: BadgeSample;
  settings: CheckinSettings;
  teamMembers: SerializedTeamMember[];
}

export function CheckinWorkspace({
  eventId,
  checkedInCount,
  expectedCount,
  eventStartInFuture,
  badgeSample,
  settings,
  teamMembers,
}: CheckinWorkspaceProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Check-in</h1>
          <p className="text-sm text-muted-foreground">
            On-site badges, QR scanning and door staff for this event.
          </p>
        </div>
        <Button asChild>
          <Link href={`/dashboard/events/${encodeURIComponent(eventId)}/checkin/scan`}>
            <ScanLine aria-hidden="true" />
            Open scanner
          </Link>
        </Button>
      </div>

      <CheckinStatCards
        checkedInCount={checkedInCount}
        expectedCount={expectedCount}
        eventStartInFuture={eventStartInFuture}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <BadgePreviewCard sample={badgeSample} />
        <div className="space-y-6">
          <CheckinSettingsCard eventId={eventId} initialSettings={settings} />
          <TeamMembersCard eventId={eventId} initialMembers={teamMembers} />
        </div>
      </div>
    </div>
  );
}
