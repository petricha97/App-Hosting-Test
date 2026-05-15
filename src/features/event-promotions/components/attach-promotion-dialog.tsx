// Dialog that lets a user attach an existing PromotionTemplate to an event.
// On confirm, it calls POST /api/dashboard/events/[eventId]/promotions which
// creates an EventPromotion subcollection doc with inheritFromParent = true
// and copies the template's current field values as the starting point.
"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SerializedPromotionTemplate } from "@/features/promotion-templates/types";

interface AttachPromotionDialogProps {
  // Whether the dialog is open.
  open: boolean;
  // The event this promotion will be attached to.
  eventId: string;
  // Org-scoped templates available to choose from (fetched server-side on the page).
  availableTemplates: SerializedPromotionTemplate[];
  // IDs of templates already attached — used to disable already-attached options.
  attachedTemplateIds: string[];
  onOpenChange: (open: boolean) => void;
  // Called after a successful attach so the parent can refresh the list.
  onAttached: () => void;
}

export function AttachPromotionDialog({
  open,
  eventId,
  availableTemplates,
  attachedTemplateIds,
  onOpenChange,
  onAttached,
}: AttachPromotionDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Calls the attach API route with the selected templateId.
  // The API copies template fields into the EventPromotion subcollection doc.
  const handleAttach = async () => {
    if (!selectedId) {
      toast.error("Please select a template to attach.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard/events/${eventId}/promotions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: selectedId }),
      });
      if (!res.ok) throw new Error(await res.text());

      toast.success("Promotion attached to event");
      setSelectedId(null);
      onOpenChange(false);
      onAttached();
    } catch {
      toast.error("Failed to attach promotion", {
        description: "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Resets selection state when the dialog closes.
  const handleOpenChange = (next: boolean) => {
    if (!next) setSelectedId(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Attach Promotion Template</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {availableTemplates.length === 0 ? (
            <p className="text-sm text-slate-500">
              No promotion templates exist for this workspace yet. Create one
              first from the Promotions page.
            </p>
          ) : (
            availableTemplates.map((template) => {
              const alreadyAttached = attachedTemplateIds.includes(template.id);
              const isSelected = selectedId === template.id;

              return (
                <button
                  key={template.id}
                  type="button"
                  disabled={alreadyAttached}
                  onClick={() => setSelectedId(template.id)}
                  className={[
                    "w-full rounded-2xl border px-4 py-3 text-left transition-colors",
                    alreadyAttached
                      ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-50"
                      : isSelected
                        ? "border-slate-900 bg-slate-950 text-white"
                        : "border-slate-200 bg-white hover:border-slate-400",
                  ].join(" ")}
                >
                  <p className="text-sm font-semibold">{template.name}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {template.discountType || "—"} ·{" "}
                    {template.discountValue ?? "—"}
                    {alreadyAttached ? " · Already attached" : ""}
                  </p>
                </button>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAttach} disabled={saving || !selectedId}>
            {saving ? "Attaching…" : "Attach"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
