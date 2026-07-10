"use client";

// Shared toolbar + filtered-empty state for the two responses browsers
// (design §4/§5, review S6): search input, optional extra filters (the
// workspace browser's event select renders via `children`), status select,
// live count badge and the CSV export button. The browsers own only their
// deltas — data loading, event filter, load-more paging.

import type { ReactNode } from "react";
import { Download, Loader2, Search } from "lucide-react";

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
import { FORM_DATA_STATUS_LABELS } from "@/features/responses/status-utils";
import { FORM_DATA_STATUSES } from "@/lib/db/formDataStatus";
import type { FormDataStatus } from "@/types/collection";

// Sentinel for the "no status filter" select item (Radix Select forbids "").
const ANY_STATUS = "any";

interface ResponsesToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  statusFilter?: FormDataStatus;
  // undefined = "Any status".
  onStatusFilterChange: (status: FormDataStatus | undefined) => void;
  count: number;
  exporting: boolean;
  onExport: () => void;
  // Extra filter controls (e.g. the workspace event select), rendered
  // between the search input and the status select.
  children?: ReactNode;
}

export function ResponsesToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  statusFilter,
  onStatusFilterChange,
  count,
  exporting,
  onExport,
  children,
}: ResponsesToolbarProps) {
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
          placeholder={searchPlaceholder}
          className="pl-9"
          aria-label="Search responses"
        />
      </div>

      {children}

      <Select
        value={statusFilter ?? ANY_STATUS}
        onValueChange={(value) =>
          onStatusFilterChange(
            value === ANY_STATUS ? undefined : (value as FormDataStatus),
          )
        }
      >
        <SelectTrigger className="w-36" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY_STATUS}>Any status</SelectItem>
          {FORM_DATA_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {FORM_DATA_STATUS_LABELS[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="flex-1" />

      <span aria-live="polite">
        <Badge variant="secondary" className="rounded-full tabular-nums">
          {count} {count === 1 ? "response" : "responses"}
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
    </div>
  );
}

// The shared filtered-empty panel (design §4 "No submissions match these
// filters" + Clear filters).
export function ResponsesFilteredEmptyState({
  onClearFilters,
}: {
  onClearFilters: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-foreground">
        No submissions match these filters
      </p>
      <p className="text-sm text-muted-foreground">
        Try a broader search or clear the filters below.
      </p>
      <Button variant="outline" onClick={onClearFilters}>
        Clear filters
      </Button>
    </div>
  );
}
