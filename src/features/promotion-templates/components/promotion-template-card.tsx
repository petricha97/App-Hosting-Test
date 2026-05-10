// Displays a single promotion template as a card with Edit and Delete actions.
// Delete calls the API route (DELETE /api/dashboard/promotions/templates/[id])
// so ownership is verified server-side before the doc is removed from Firestore.
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SerializedPromotionTemplate } from "@/features/promotion-templates/types";

interface PromotionTemplateCardProps {
  template: SerializedPromotionTemplate;
  onEdit: (template: SerializedPromotionTemplate) => void;
  onDeleted: () => void;
}

export function PromotionTemplateCard({
  template,
  onEdit,
  onDeleted,
}: PromotionTemplateCardProps) {
  const [deleting, setDeleting] = useState(false);

  // Calls the DELETE API route after a confirmation prompt.
  // onDeleted triggers router.refresh() in the parent to re-fetch the list.
  const handleDelete = async () => {
    if (!confirm(`Delete template "${template.name}"?`)) return;

    setDeleting(true);
    try {
      const res = await fetch(
        `/api/dashboard/promotions/templates/${template.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await res.text());
      toast.success("Template deleted");
      onDeleted();
    } catch {
      toast.error("Failed to delete template", {
        description: "Please try again.",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-xl text-slate-950">
            {template.name}
          </CardTitle>
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => onEdit(template)}
            >
              Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="rounded-full"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 px-6 pb-6 pt-0 text-sm text-slate-600">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 px-4 py-3 shadow-sm">
              <span className="font-medium text-slate-950">Type: </span>
              {template.discountType || "—"}
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 shadow-sm">
              <span className="font-medium text-slate-950">Value: </span>
              {template.discountValue ?? "—"}
            </div>
          </div>
          {template.description ? (
            <p className="text-slate-500">{template.description}</p>
          ) : null}
          {template.conditions.length > 0 ? (
            <p className="text-slate-400 text-xs">
              {template.conditions.length} condition
              {template.conditions.length !== 1 ? "s" : ""}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  );
}
