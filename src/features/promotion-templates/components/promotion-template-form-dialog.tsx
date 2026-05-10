// Modal dialog for creating and editing promotion templates.
// Renders dynamic form fields from promotionTemplateFields and a conditions builder.
// Mutations go through API routes so session and permissions are verified server-side.
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  promotionTemplateSchema,
  type PromotionTemplateFormValues,
} from "@/features/promotion-templates/schema";
import {
  promotionTemplateFields,
  CONDITION_FIELD_OPTIONS,
} from "@/features/promotion-templates/fields";
import type { SerializedPromotionTemplate } from "@/features/promotion-templates/types";

interface PromotionTemplateFormDialogProps {
  open: boolean;
  editData: SerializedPromotionTemplate | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const emptyForm: PromotionTemplateFormValues = {
  name: "",
  description: "",
  discountType: "",
  conditions: [],
};

export function PromotionTemplateFormDialog({
  open,
  editData,
  onOpenChange,
  onSaved,
}: PromotionTemplateFormDialogProps) {
  const [form, setForm] = useState<PromotionTemplateFormValues>(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editData) {
      setForm({
        name: editData.name,
        description: editData.description,
        discountType: editData.discountType,
        discountValue: editData.discountValue || undefined,
        conditions: editData.conditions,
      });
    } else {
      setForm(emptyForm);
    }
  }, [open, editData]);

  // Generic field updater — keeps form state immutable.
  function handleChange<K extends keyof PromotionTemplateFormValues>(
    key: K,
    value: PromotionTemplateFormValues[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Validates with Zod, then POSTs to the create or update API route.
  // On success closes the dialog and triggers a page refresh via onSaved.
  const handleSave = async () => {
    const parsed = promotionTemplateSchema.safeParse(form);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message ?? "Please fix the form errors.");
      return;
    }

    setSaving(true);
    try {
      if (editData) {
        const res = await fetch(
          `/api/dashboard/promotions/templates/${editData.id}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsed.data),
          },
        );
        if (!res.ok) throw new Error(await res.text());
        toast.success("Template updated");
      } else {
        const res = await fetch("/api/dashboard/promotions/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Template created");
      }

      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Failed to save template", {
        description: "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editData ? "Edit Template" : "New Template"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {promotionTemplateFields.map((field) =>
            field.type === "textarea" ? (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={field.key}>{field.label}</Label>
                <Textarea
                  id={field.key}
                  placeholder={field.placeholder ?? field.label}
                  value={(form[field.key] as string) ?? ""}
                  onChange={(e) =>
                    handleChange(field.key, e.target.value as never)
                  }
                  disabled={!!editData && field.disabledOnEdit}
                />
              </div>
            ) : (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input
                  id={field.key}
                  type={field.type ?? "text"}
                  placeholder={field.placeholder ?? field.label}
                  value={(form[field.key] as string | number) ?? ""}
                  onChange={(e) =>
                    handleChange(field.key, e.target.value as never)
                  }
                  disabled={!!editData && field.disabledOnEdit}
                />
              </div>
            ),
          )}

          <div className="space-y-3 pt-2">
            <p className="text-sm font-semibold text-slate-950">Conditions</p>

            {form.conditions.map((cond, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3"
              >
                <div className="col-span-4 space-y-1">
                  <Label className="text-xs text-slate-500">Field</Label>
                  <Select
                    value={cond.field}
                    onValueChange={(value: string) => {
                      const updated = [...form.conditions];
                      updated[idx] = { ...updated[idx], field: value };
                      handleChange("conditions", updated);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select field" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_FIELD_OPTIONS.map((opt) => (
                        <SelectItem key={opt.key} value={opt.key}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="col-span-4 space-y-1">
                  <Label className="text-xs text-slate-500">Operator</Label>
                  <Select
                    value={cond.operator}
                    onValueChange={(value: string) => {
                      const updated = [...form.conditions];
                      updated[idx] = { ...updated[idx], operator: value };
                      handleChange("conditions", updated);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Operator" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="=">=</SelectItem>
                      <SelectItem value="!=">!=</SelectItem>
                      <SelectItem value=">">&gt;</SelectItem>
                      <SelectItem value="<">&lt;</SelectItem>
                      <SelectItem value=">=">&gt;=</SelectItem>
                      <SelectItem value="<=">&lt;=</SelectItem>
                      <SelectItem value="contains">contains</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="col-span-3 space-y-1">
                  <Label className="text-xs text-slate-500">Value</Label>
                  <Input
                    placeholder="e.g. 18"
                    value={String(cond.value ?? "")}
                    onChange={(e) => {
                      const updated = [...form.conditions];
                      updated[idx] = { ...updated[idx], value: e.target.value };
                      handleChange("conditions", updated);
                    }}
                  />
                </div>

                <div className="col-span-1 flex items-end justify-end">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      handleChange(
                        "conditions",
                        form.conditions.filter((_, i) => i !== idx),
                      );
                    }}
                  >
                    ×
                  </Button>
                </div>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() =>
                handleChange("conditions", [
                  ...form.conditions,
                  { field: "", operator: "", value: "" },
                ])
              }
            >
              Add condition
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
