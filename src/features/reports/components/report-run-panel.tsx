"use client";

// Shared "Run" output panel (M7-T2, design §3) — ONE component, parameterized
// by templateSlug, renders all 5 templates' output differing only by the
// column-header list / row-cell renderer it's given (templates.ts config),
// not five near-duplicate components. The parent renders this with
// `key={activeTemplate}` (report-templates-section.tsx) so switching
// templates forces a clean remount — no stale data ever flashes from the
// previously-open template (design §3).
import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  getReportTemplate,
  type ReportTemplateId,
} from "@/features/reports/templates";
import type { ReportPage, ReportRow } from "@/features/reports/types";

export interface ReportRunPanelProps {
  eventId: string;
  slug: ReportTemplateId;
  exporting: boolean;
  onExport: () => void;
  onClose: () => void;
}

function formatCellDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function RunPanelSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center gap-4">
          <Skeleton className="h-5 w-1/3 min-w-32" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-12" />
        </div>
      ))}
    </div>
  );
}

export function ReportRunPanel({
  eventId,
  slug,
  exporting,
  onExport,
  onClose,
}: ReportRunPanelProps) {
  const template = getReportTemplate(slug);
  const panelRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<ReportRow[]>([]);
  const [cursorMs, setCursorMs] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const runUrl = `/api/dashboard/events/${encodeURIComponent(eventId)}/reports/${slug}`;

  const fetchFirstPage = async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(runUrl);
      if (!response.ok) {
        setError(true);
        return;
      }
      const data = (await response.json()) as ReportPage;
      setRows(data.rows);
      setCursorMs(data.nextCursorMs);
      setHasMore(data.hasMore);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchFirstPage();
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    panelRef.current?.focus();
    // Fires once per mount — the parent forces a remount via key={slug} on
    // template switch, so this never needs slug in the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (cursorMs !== null) params.set("cursor", String(cursorMs));
      const response = await fetch(`${runUrl}?${params.toString()}`);
      if (!response.ok) {
        setError(true);
        return;
      }
      const data = (await response.json()) as ReportPage;
      setRows((current) => [...current, ...data.rows]);
      setCursorMs(data.nextCursorMs);
      setHasMore(data.hasMore);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  if (!template) return null;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      id="report-run-panel"
      role="region"
      aria-label={`${template.name} — report output`}
    >
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold">
              {template.name}
            </CardTitle>
            <CardDescription>{template.description}</CardDescription>
            {template.note ? (
              <p className="text-xs text-muted-foreground">{template.note}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Download aria-hidden="true" />
              )}
              Export CSV
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Hide
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <EntityTableError
              entityLabel={template.entityLabel}
              onRetry={() => void fetchFirstPage()}
            />
          ) : loading ? (
            <RunPanelSkeleton />
          ) : rows.length === 0 ? (
            <EntityEmptyState
              icon={template.emptyState.icon}
              title={template.emptyState.title}
              description={template.emptyState.description}
              actionLabel={template.emptyState.ctaLabel}
              href={
                template.emptyState.ctaHrefSuffix
                  ? `/dashboard/events/${encodeURIComponent(eventId)}/${template.emptyState.ctaHrefSuffix}`
                  : undefined
              }
            />
          ) : (
            <>
              <div
                className="overflow-x-auto"
                tabIndex={0}
                aria-label={`${template.name} — scrollable table`}
              >
                <Table className={template.minWidthClassName}>
                  <TableHeader>
                    <TableRow>
                      {template.columns.map((column) => (
                        <TableHead
                          key={column.key}
                          className={
                            column.isNumeric ? "tabular-nums" : undefined
                          }
                        >
                          {column.header}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, index) => (
                      <TableRow key={index}>
                        {template.columns.map((column) => {
                          const raw = row[column.key] ?? "";
                          const display =
                            column.isDateTime && raw
                              ? formatCellDateTime(raw)
                              : raw;
                          return (
                            <TableCell
                              key={column.key}
                              className={
                                column.isNumeric ? "tabular-nums" : undefined
                              }
                            >
                              {display || (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {hasMore ? (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
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
        </CardContent>
      </Card>
    </div>
  );
}
