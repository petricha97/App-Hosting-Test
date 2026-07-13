"use client";

// Attendee-list toolbar (M5-T2, design §1): search, status select
// (All / Accepted / Pending), live "N attendees" badge (N = ACCEPTED attendee
// count — never the visible row count, spec AC-2), CSV export and the
// "+ Register attendee" primary action. Clones the ResponsesToolbar layout.

import { Download, Loader2, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RosterRowStatus } from "@/features/attendees/roster";

// Sentinel for the "no status filter" select item (Radix Select forbids "").
const ANY_STATUS = "any";

interface AttendeesToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter?: RosterRowStatus;
  onStatusFilterChange: (status: RosterRowStatus | undefined) => void;
  // Accepted Attendee count (aggregate query), NOT the visible row count.
  acceptedCount: number;
  exporting: boolean;
  onExport: () => void;
  onRegister: () => void;
}

export function AttendeesToolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  acceptedCount,
  exporting,
  onExport,
  onRegister,
}: AttendeesToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <div className="relative min-w-56 flex-1 sm:max-w-xs">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search name / email…"
          className="pl-9"
          aria-label="Search attendees"
        />
      </div>

      <Select
        value={statusFilter ?? ANY_STATUS}
        onValueChange={(value) =>
          onStatusFilterChange(
            value === ANY_STATUS ? undefined : (value as RosterRowStatus),
          )
        }
      >
        <SelectTrigger className="w-36" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY_STATUS}>All statuses</SelectItem>
          <SelectItem value="accepted">Accepted</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
        </SelectContent>
      </Select>

      <span className="flex-1" />

      <span aria-live="polite">
        <Badge variant="secondary" className="rounded-full tabular-nums">
          {acceptedCount} {acceptedCount === 1 ? "attendee" : "attendees"}
        </Badge>
      </span>

      <Button variant="outline" onClick={onExport} disabled={exporting}>
        {exporting ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <Download aria-hidden="true" />
        )}
        Export CSV
      </Button>

      <Button onClick={onRegister}>
        <Plus aria-hidden="true" />
        Register attendee
      </Button>
    </div>
  );
}
