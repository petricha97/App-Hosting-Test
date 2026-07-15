"use client";

// Shared send-log table (design §5) — used by BOTH send-log-tab.tsx
// (event-wide, status+kind filters) and email-history-tab.tsx (kind locked,
// status filter only) — "one table implementation, not two". Owns its own
// fetch/pagination/expand/retry state; filter CHANGES are reported to the
// parent via `onFilterChange` so the event-wide tab can mirror them into the
// URL (design: "drive the query via URL params... not client-side
// filtering").
import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Inbox, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EntityEmptyState,
  EntityTableError,
} from "@/features/registration/components/entity-table-states";
import { SendLogRowDetail } from "@/features/emails/components/send-log-row-detail";
import type {
  SerializedEmailDefinition,
  SerializedEmailMessage,
} from "@/features/emails/types";
import { resolveEmailDefinitionName } from "@/features/emails/utils";
import type { EmailMessageStatus } from "@/types/collection";

type StatusFilter = "all" | EmailMessageStatus;

interface KindOption {
  value: string;
  label: string;
}

interface SendLogTableProps {
  eventId: string;
  definitionsByKind: Map<string, SerializedEmailDefinition>;
  initialMessages: SerializedEmailMessage[];
  initialCount: number;
  initialNextCursor: number | null;
  // History tab: fixed kind, no kind selector.
  lockedKind?: string;
  kindOptions?: KindOption[];
  compact?: boolean;
  onFilterChange?: (filters: { status: StatusFilter; kind: string }) => void;
}

function statusTime(message: SerializedEmailMessage): number | null {
  return (
    message.sentAtMs ??
    message.failedAtMs ??
    message.queuedAtMs ??
    message.createdAtMs
  );
}

function formatTime(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: EmailMessageStatus) {
  if (status === "sent") {
    return (
      <Badge className="rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
        Sent
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="rounded-full bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200">
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="rounded-full">
      Queued
    </Badge>
  );
}

export function SendLogTable({
  eventId,
  definitionsByKind,
  initialMessages,
  initialCount,
  initialNextCursor,
  lockedKind,
  kindOptions = [],
  compact = false,
  onFilterChange,
}: SendLogTableProps) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<string>(lockedKind ?? "all");
  const [messages, setMessages] = useState(initialMessages);
  const [count, setCount] = useState(initialCount);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const buildUrl = (cursor?: number | null) => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    else if (kind !== "all") params.set("kind", kind);
    if (cursor !== undefined && cursor !== null)
      params.set("cursor", String(cursor));
    const query = params.toString();
    return `/api/dashboard/events/${encodeURIComponent(eventId)}/emails/messages${query ? `?${query}` : ""}`;
  };

  const fetchPage = async (replace: boolean) => {
    replace ? setLoading(true) : setLoadingMore(true);
    setError(false);
    try {
      const response = await fetch(buildUrl(replace ? undefined : nextCursor));
      if (!response.ok) {
        setError(true);
        return;
      }
      const data = (await response.json()) as {
        messages: SerializedEmailMessage[];
        count: number;
        nextCursor: number | null;
      };
      setMessages((current) =>
        replace ? data.messages : [...current, ...data.messages],
      );
      setCount(data.count);
      setNextCursor(data.nextCursor);
    } catch {
      setError(true);
    } finally {
      replace ? setLoading(false) : setLoadingMore(false);
    }
  };

  // Refetch from scratch whenever a filter changes (skip the very first
  // render — server-provided initial data already matches "all"/"all").
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onFilterChange?.({ status, kind: lockedKind ?? kind });
    void fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, kind]);

  const handleStatusChange = (value: string) => {
    setStatus(value as StatusFilter);
    if (!lockedKind) setKind("all"); // mutually exclusive (design §5)
  };

  const handleKindChange = (value: string) => {
    setKind(value);
    setStatus("all");
  };

  const handleRetry = async (message: SerializedEmailMessage) => {
    setRetryingId(message.id);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/emails/messages/${encodeURIComponent(message.id)}/retry`,
        { method: "POST" },
      );
      const data = (await response.json().catch(() => null)) as {
        message?: SerializedEmailMessage;
        error?: unknown;
      } | null;

      if (!response.ok) {
        if (response.status === 409) {
          toast.error("This email was already sent");
        } else {
          toast.error(
            typeof data?.error === "string"
              ? data.error
              : "Failed to retry the email.",
          );
        }
        // Refresh in place so a raced retry never shows a stale status.
        await fetchPage(true);
        return;
      }

      if (data?.message) {
        setMessages((current) =>
          current.map((row) => (row.id === message.id ? data.message! : row)),
        );
        toast.success(
          data.message.status === "sent" ? "Email resent" : "Retry attempted",
        );
      }
    } catch {
      toast.error("Failed to retry the email.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setRetryingId(null);
    }
  };

  // Recipient, Email, Subject, Status, Time, Attempts, Expand, Retry.
  const columnCount = 8;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Select value={status} onValueChange={handleStatusChange}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        {!lockedKind ? (
          <Select value={kind} onValueChange={handleKindChange}>
            <SelectTrigger size="sm" className="w-48">
              <SelectValue placeholder="All kinds" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              <SelectItem value="test">Test send</SelectItem>
              {kindOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {!compact ? (
          <>
            <span className="flex-1" />
            <span aria-live="polite">
              <Badge variant="secondary" className="rounded-full tabular-nums">
                {count} sent
              </Badge>
            </span>
          </>
        ) : null}
      </div>

      {!lockedKind && !compact ? (
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          Filter by status or by email — not both at once.
        </p>
      ) : null}

      {error ? (
        <div className="p-4">
          <EntityTableError
            entityLabel="the send log"
            onRetry={() => fetchPage(true)}
          />
        </div>
      ) : loading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-8 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="p-4">
          <EntityEmptyState
            icon={Inbox}
            title="No emails sent yet"
            description="The log fills when automations go live (M6-T3) or when you send a test."
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table aria-label="Send log" className="min-w-[56rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-40">Recipient</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="max-w-64">Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-center">Attempts</TableHead>
                  <TableHead>
                    <span className="sr-only">Expand</span>
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">Retry</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.map((message) => {
                  const isExpanded = expandedId === message.id;
                  const rowId = `send-log-detail-${message.id}`;
                  const definitionName = resolveEmailDefinitionName(
                    message.kind,
                    definitionsByKind,
                  );

                  return (
                    <Fragment key={message.id}>
                      <TableRow>
                        <TableCell>
                          <div className="font-medium text-foreground">
                            {message.recipient.name || "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {message.recipient.email}
                          </div>
                        </TableCell>
                        <TableCell>
                          {definitionName ?? (
                            <Badge
                              variant="outline"
                              className="font-mono text-xs"
                            >
                              {message.kind}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell
                          className="max-w-64 truncate"
                          title={message.subject}
                        >
                          {message.subject}
                        </TableCell>
                        <TableCell>{statusBadge(message.status)}</TableCell>
                        <TableCell
                          className="tabular-nums"
                          title={
                            statusTime(message) !== null
                              ? new Date(statusTime(message)!).toISOString()
                              : undefined
                          }
                        >
                          {formatTime(statusTime(message))}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {message.attemptCount}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={
                              isExpanded ? "Collapse details" : "Expand details"
                            }
                            aria-expanded={isExpanded}
                            aria-controls={rowId}
                            onClick={() =>
                              setExpandedId(isExpanded ? null : message.id)
                            }
                          >
                            {isExpanded ? (
                              <ChevronDown aria-hidden="true" />
                            ) : (
                              <ChevronRight aria-hidden="true" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell>
                          {message.status === "failed" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={retryingId === message.id}
                              onClick={() => handleRetry(message)}
                            >
                              {retryingId === message.id ? (
                                <Loader2
                                  aria-hidden="true"
                                  className="animate-spin"
                                />
                              ) : null}
                              Retry
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                      {isExpanded ? (
                        <SendLogRowDetail
                          message={message}
                          colSpan={columnCount}
                          rowId={rowId}
                        />
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {nextCursor !== null ? (
            <div className="border-t border-border p-3">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                disabled={loadingMore}
                onClick={() => fetchPage(false)}
              >
                {loadingMore ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
