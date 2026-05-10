// Client Component that owns the dialog open/edit state for the templates list.
// Receives pre-fetched templates from the Server Component page and calls
// router.refresh() after any mutation to re-sync with Firestore.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import { PromotionTemplateCard } from "@/features/promotion-templates/components/promotion-template-card";
import { PromotionTemplateFormDialog } from "@/features/promotion-templates/components/promotion-template-form-dialog";
import type { SerializedPromotionTemplate } from "@/features/promotion-templates/types";

interface PromotionTemplatesBrowserProps {
  initialTemplates: SerializedPromotionTemplate[];
  workspaceName: string | null;
}

export function PromotionTemplatesBrowser({
  initialTemplates,
  workspaceName,
}: PromotionTemplatesBrowserProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<SerializedPromotionTemplate | null>(
    null,
  );

  // Opens the form dialog in create mode (no pre-filled data).
  const handleAdd = () => {
    setEditData(null);
    setDialogOpen(true);
  };

  // Opens the form dialog pre-filled with the selected template's data.
  const handleEdit = (template: SerializedPromotionTemplate) => {
    setEditData(template);
    setDialogOpen(true);
  };

  // Called after a successful create, update, or delete to re-fetch the list.
  const handleSaved = () => {
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Promotions"
        title="Promotion Templates"
        description={`Reusable discount templates for ${workspaceName ?? "this workspace"}.`}
        actions={
          <Button className="rounded-full" onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            New template
          </Button>
        }
      />

      {initialTemplates.length > 0 ? (
        <section className="grid gap-6 lg:grid-cols-2">
          {initialTemplates.map((template) => (
            <PromotionTemplateCard
              key={template.id}
              template={template}
              onEdit={handleEdit}
              onDeleted={handleSaved}
            />
          ))}
        </section>
      ) : (
        <div className="rounded-[2rem] border border-white/70 bg-white/92 px-6 py-10 text-center shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <p className="text-sm text-slate-500">
            No promotion templates yet. Create the first one.
          </p>
          <Button className="mt-4 rounded-full" onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            New template
          </Button>
        </div>
      )}

      <PromotionTemplateFormDialog
        open={dialogOpen}
        editData={editData}
        onOpenChange={setDialogOpen}
        onSaved={handleSaved}
      />
    </div>
  );
}
