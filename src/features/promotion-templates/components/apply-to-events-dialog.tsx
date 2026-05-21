"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EligibleEvent } from "@/app/api/dashboard/promotions/templates/[templateId]/eligible-events/route";

interface ApplyToEventsDialogProps {
  open: boolean;
  templateId: string;
  templateName: string;
  onOpenChange: (open: boolean) => void;
}

type Step = "select" | "confirm";

export function ApplyToEventsDialog({
  open,
  templateId,
  templateName,
  onOpenChange,
}: ApplyToEventsDialogProps) {
  const [events, setEvents] = useState<EligibleEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>("select");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep("select");
      setSelectedIds(new Set());
      setEvents([]);
      return;
    }

    setLoading(true);
    fetch(
      `/api/dashboard/promotions/templates/${templateId}/eligible-events`,
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const { events: fetched }: { events: EligibleEvent[] } = await res.json();
        setEvents(fetched ?? []);
      })
      .catch(() => {
        toast.error("Failed to load events");
      })
      .finally(() => setLoading(false));
  }, [open, templateId]);

  const toggleEvent = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectedCustomEvents = events.filter(
    (e) => selectedIds.has(e.id) && e.hasPromotion && !e.inheritFromParent,
  );

  const handleApplyClick = () => {
    if (selectedIds.size === 0) {
      toast.error("Select at least one event.");
      return;
    }
    if (selectedCustomEvents.length > 0) {
      setStep("confirm");
    } else {
      applyToEvents(false);
    }
  };

  const applyToEvents = async (overwriteCustom: boolean) => {
    setApplying(true);
    try {
      const res = await fetch(
        `/api/dashboard/promotions/templates/${templateId}/apply-to-events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventIds: Array.from(selectedIds),
            overwriteCustom,
          }),
        },
      );
      if (!res.ok) throw new Error(await res.text());

      const { updated, skippedCustom } = await res.json();
      const skipped = skippedCustom?.length ?? 0;

      if (updated > 0 && skipped > 0) {
        toast.success(
          `Applied to ${updated} event${updated !== 1 ? "s" : ""} — ${skipped} custom event${skipped !== 1 ? "s" : ""} skipped`,
        );
      } else if (updated > 0) {
        toast.success(
          `Applied to ${updated} event${updated !== 1 ? "s" : ""}`,
        );
      } else {
        toast.info("No events were updated");
      }

      onOpenChange(false);
    } catch {
      toast.error("Failed to apply template", {
        description: "Please try again.",
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "select"
              ? `Apply "${templateName}" to events`
              : "Confirm overwrite"}
          </DialogTitle>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-3">
            {loading ? (
              <p className="text-sm text-slate-500">Loading events…</p>
            ) : events.length === 0 ? (
              <p className="text-sm text-slate-500">
                No ongoing or upcoming events found.
              </p>
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {events.map((event) => (
                  <label
                    key={event.id}
                    className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 hover:bg-slate-100"
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={selectedIds.has(event.id)}
                        onChange={() => toggleEvent(event.id)}
                      />
                      <span className="text-sm text-slate-900">
                        {event.name}
                      </span>
                    </div>
                    {event.hasPromotion && !event.inheritFromParent && (
                      <Badge
                        variant="outline"
                        className="border-amber-200 bg-amber-50 text-xs text-amber-700"
                      >
                        Custom
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleApplyClick}
                disabled={loading || selectedIds.size === 0}
              >
                Apply
              </Button>
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-sm text-amber-800">
                <strong>{selectedCustomEvents.length}</strong> selected event
                {selectedCustomEvents.length !== 1 ? "s have" : " has"} custom
                promotion settings that differ from this template. Overwriting
                will replace those custom settings.
              </p>
            </div>

            <ul className="space-y-1 pl-1 text-sm text-slate-600">
              {selectedCustomEvents.map((e) => (
                <li key={e.id} className="truncate">
                  · {e.name}
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setStep("select")}>
                Back
              </Button>
              <Button
                variant="outline"
                onClick={() => applyToEvents(false)}
                disabled={applying}
              >
                {applying ? "Applying…" : "Apply to inheriting only"}
              </Button>
              <Button
                onClick={() => applyToEvents(true)}
                disabled={applying}
              >
                {applying ? "Applying…" : "Overwrite all"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
