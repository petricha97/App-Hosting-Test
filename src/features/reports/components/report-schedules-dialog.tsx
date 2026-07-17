"use client";

// Schedule management dialog (M7-T3 spec §1, OQ-1's recommended shape —
// mirrors M6-T2's sender-settings-dialog.tsx: one global settings surface
// opened from a single topbar button). Two internal views:
//   - "list": the event's 0-5 existing schedules (empty state, per-row
//     Edit/Pause-Resume/Delete) + "+ Add schedule".
//   - "form": create (template picker limited to un-scheduled templates) or
//     edit (template fixed) a single schedule (report-schedule-form.tsx).
import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DeleteEntityDialog } from "@/features/registration/components/delete-entity-dialog";
import {
  EntityEmptyState,
  EntityTableError,
} from "@/features/registration/components/entity-table-states";
import { ReportScheduleForm } from "@/features/reports/components/report-schedule-form";
import { formatScheduleCadence } from "@/features/reports/schedule-utils";
import {
  getReportTemplate,
  REPORT_TEMPLATE_IDS,
  type ReportTemplateId,
} from "@/features/reports/templates";
import type { SerializedReportSchedule } from "@/features/reports/types";

interface ReportSchedulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  timeZone: string;
  currentUserEmail: string;
}

function schedulesUrl(eventId: string): string {
  return `/api/dashboard/events/${encodeURIComponent(eventId)}/reports/schedules`;
}

function scheduleUrl(eventId: string, templateSlug: string): string {
  return `${schedulesUrl(eventId)}/${templateSlug}`;
}

export function ReportSchedulesDialog({
  open,
  onOpenChange,
  eventId,
  timeZone,
  currentUserEmail,
}: ReportSchedulesDialogProps) {
  const [view, setView] = useState<"list" | "form">("list");
  const [schedules, setSchedules] = useState<SerializedReportSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [formTemplateSlug, setFormTemplateSlug] =
    useState<ReportTemplateId | null>(null);

  const [togglingSlug, setTogglingSlug] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<SerializedReportSchedule | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const fetchSchedules = async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(schedulesUrl(eventId));
      if (!response.ok) {
        setError(true);
        return;
      }
      const data = await response.json();
      setSchedules(data.schedules as SerializedReportSchedule[]);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setView("list");
      void fetchSchedules();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId]);

  const availableTemplateSlugs = REPORT_TEMPLATE_IDS.filter(
    (slug) => !schedules.some((s) => s.templateSlug === slug),
  );

  const openCreate = () => {
    if (availableTemplateSlugs.length === 0) return;
    setFormMode("create");
    setFormTemplateSlug(availableTemplateSlugs[0]);
    setView("form");
  };

  const openEdit = (schedule: SerializedReportSchedule) => {
    setFormMode("edit");
    setFormTemplateSlug(schedule.templateSlug as ReportTemplateId);
    setView("form");
  };

  const handleSaved = (schedule: SerializedReportSchedule) => {
    setSchedules((current) => {
      const withoutIt = current.filter(
        (s) => s.templateSlug !== schedule.templateSlug,
      );
      return [...withoutIt, schedule];
    });
    toast.success("Schedule saved");
    setView("list");
  };

  const toggleEnabled = async (schedule: SerializedReportSchedule) => {
    setTogglingSlug(schedule.templateSlug);
    try {
      const response = await fetch(
        scheduleUrl(eventId, schedule.templateSlug),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frequency: schedule.frequency,
            dayOfWeek: schedule.dayOfWeek,
            dayOfMonth: schedule.dayOfMonth,
            hour: schedule.hour,
            minute: schedule.minute,
            recipientEmails: schedule.recipients.map((r) => r.email),
            enabled: !schedule.enabled,
          }),
        },
      );
      if (!response.ok) {
        toast.error(
          schedule.enabled
            ? "Failed to pause the schedule."
            : "Failed to resume the schedule.",
        );
        return;
      }
      const data = await response.json();
      const updated = data.schedule as SerializedReportSchedule;
      setSchedules((current) =>
        current.map((s) =>
          s.templateSlug === updated.templateSlug ? updated : s,
        ),
      );
      toast.success(updated.enabled ? "Schedule resumed" : "Schedule paused");
    } catch {
      toast.error("Failed to update the schedule.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setTogglingSlug(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletePending(true);
    try {
      const response = await fetch(
        scheduleUrl(eventId, deleteTarget.templateSlug),
        { method: "DELETE" },
      );
      if (!response.ok) {
        toast.error("Failed to delete the schedule.");
        return;
      }
      setSchedules((current) =>
        current.filter((s) => s.templateSlug !== deleteTarget.templateSlug),
      );
      toast.success("Schedule deleted");
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to delete the schedule.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setDeletePending(false);
    }
  };

  const editingSchedule =
    formTemplateSlug !== null
      ? (schedules.find((s) => s.templateSlug === formTemplateSlug) ?? null)
      : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {view === "list"
                ? "Scheduled reports"
                : formMode === "create"
                  ? "Add schedule"
                  : `Edit schedule — ${getReportTemplate(formTemplateSlug ?? "")?.name ?? ""}`}
            </DialogTitle>
            <DialogDescription>
              {view === "list"
                ? "Recurring email reminders that link back to a report — never row data or attendee PII."
                : "Choose how often this report's link is emailed, and to whom."}
            </DialogDescription>
          </DialogHeader>

          {view === "form" && formTemplateSlug ? (
            <ReportScheduleForm
              eventId={eventId}
              timeZone={timeZone}
              currentUserEmail={currentUserEmail}
              mode={formMode}
              templateSlug={formTemplateSlug}
              availableTemplateSlugs={availableTemplateSlugs}
              onTemplateSlugChange={setFormTemplateSlug}
              existingSchedule={editingSchedule}
              onSaved={handleSaved}
              onCancel={() => setView("list")}
            />
          ) : error ? (
            <EntityTableError
              entityLabel="scheduled reports"
              onRetry={() => void fetchSchedules()}
            />
          ) : loading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : schedules.length === 0 ? (
            <EntityEmptyState
              icon={CalendarClock}
              title="No scheduled reports yet"
              description="Set up a recurring email reminder that links back to a report."
              actionLabel="+ Add schedule"
              onAction={openCreate}
            />
          ) : (
            <div className="space-y-3">
              <ul className="space-y-2">
                {schedules.map((schedule) => {
                  const template = getReportTemplate(schedule.templateSlug);
                  const isToggling = togglingSlug === schedule.templateSlug;
                  return (
                    <li
                      key={schedule.templateSlug}
                      className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground">
                            {template?.name ?? schedule.templateSlug}
                          </p>
                          <Badge
                            variant={schedule.enabled ? "default" : "secondary"}
                          >
                            {schedule.enabled ? "Active" : "Paused"}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {formatScheduleCadence({ ...schedule, timeZone })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {schedule.recipients.length} recipient
                          {schedule.recipients.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(schedule)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isToggling}
                          onClick={() => void toggleEnabled(schedule)}
                          aria-label={
                            schedule.enabled
                              ? "Pause schedule"
                              : "Resume schedule"
                          }
                        >
                          {isToggling ? (
                            <Loader2
                              aria-hidden="true"
                              className="animate-spin"
                            />
                          ) : schedule.enabled ? (
                            <Pause aria-hidden="true" />
                          ) : (
                            <Play aria-hidden="true" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Delete schedule"
                          onClick={() => setDeleteTarget(schedule)}
                        >
                          <Trash2
                            aria-hidden="true"
                            className="text-destructive"
                          />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {availableTemplateSlugs.length > 0 ? (
                <Button variant="outline" onClick={openCreate}>
                  + Add schedule
                </Button>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <DeleteEntityDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget ? (getReportTemplate(deleteTarget.templateSlug)?.name ?? "schedule") : "schedule"}?`}
        description="This stops future emails for this schedule. Historical send records are kept."
        blockedMessage={null}
        pending={deletePending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
