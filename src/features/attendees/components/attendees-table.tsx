"use client";

// Merged roster table (M5-T2, design §1): Name | Email | Company | Ticket |
// Status | Check-in. Accepted rows carry the live check-in cell ("Not
// arrived" muted / "Checked in HH:MM" emerald); Pending rows render em-dash
// cells where no data exists yet. The check-in column contract is fixed here
// (T2 AC-10) — Pass B's scanner flips the underlying state.

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AttendeeStatusBadge } from "@/features/attendees/components/attendee-status-badge";
import {
  formatCheckInTime,
  type SerializedAttendeeRow,
} from "@/features/attendees/roster";
import { cn } from "@/lib/utils";

function EmDash() {
  return <span className="text-muted-foreground">—</span>;
}

function CheckInCell({ row }: { row: SerializedAttendeeRow }) {
  if (row.kind === "pending") {
    return <EmDash />;
  }

  if (row.checkInState === "checked-in" && row.checkedInAtIso) {
    return (
      <Badge
        className={cn(
          "rounded-full",
          "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
        )}
      >
        Checked in{" "}
        <span className="tabular-nums">
          {formatCheckInTime(row.checkedInAtIso)}
        </span>
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="rounded-full text-muted-foreground">
      Not arrived
    </Badge>
  );
}

export function AttendeesTable({ rows }: { rows: SerializedAttendeeRow[] }) {
  return (
    <div className="overflow-x-auto">
      <Table aria-label="Attendees" className="min-w-[56rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-40">Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Ticket</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Check-in</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.kind}-${row.id}`}>
              <TableCell className="font-medium text-foreground">
                {row.name}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.email || <EmDash />}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.company || <EmDash />}
              </TableCell>
              <TableCell>{row.ticketLabel ?? <EmDash />}</TableCell>
              <TableCell>
                <AttendeeStatusBadge status={row.status} />
              </TableCell>
              <TableCell>
                <CheckInCell row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
