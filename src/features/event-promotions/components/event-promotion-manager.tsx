// Client Component that manages the list of promotions attached to a single event.
// Handles three operations, all via API routes so auth is checked server-side:
//   - Attach: opens AttachPromotionDialog to link a template to this event
//   - Edit:   inline editing of event-level promotion fields (does NOT touch parent template)
//   - Detach: removes the EventPromotion subcollection doc from this event
//
// Each promotion card shows:
//   - Human-readable condition rules (e.g. "Age ≥ 18") instead of a plain count
//   - A "Promo code required" badge with the code, or an "Auto-apply" badge
//
// After any mutation, calls router.refresh() to re-fetch the updated list.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Tag, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AttachPromotionDialog } from "@/features/event-promotions/components/attach-promotion-dialog";
import { formatConditionRule } from "@/features/event-promotions/utils";
import type {
  SerializedEventPromotion,
  SerializedEventPromotionCondition,
} from "@/features/event-promotions/types";
import type { SerializedPromotionTemplate } from "@/features/promotion-templates/types";
import { CONDITION_FIELD_OPTIONS } from "@/features/promotion-templates/fields";

interface EventPromotionManagerProps {
  eventId: string;
  // Event-level promotion copies fetched from the subcollection.
  promotions: SerializedEventPromotion[];
  // Org-scoped templates passed from the server for the attach dialog.
  availableTemplates: SerializedPromotionTemplate[];
}

// Tracks which promotion row is currently open for inline editing.
// conditions is included so users can customise rules when not inheriting from the parent.
type EditingState = {
  id: string;
  name: string;
  discountType: string;
  discountValue: string;
  inheritFromParent: boolean;
  enablePromoCode: boolean;
  promoCode: string;
  conditions: SerializedEventPromotionCondition[];
};

export function EventPromotionManager({
  eventId,
  promotions,
  availableTemplates,
}: EventPromotionManagerProps) {
  const router = useRouter();
  const [attachOpen, setAttachOpen] = useState(false);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // IDs of templates already attached — prevents duplicates in the attach dialog.
  const attachedTemplateIds = promotions.map((p) => p.templateId);

  // Refreshes the Server Component above so the updated subcollection is re-fetched.
  const refresh = () => router.refresh();

  // Opens the inline edit form pre-filled with the selected promotion's current values.
  // Disables inheritance by default — editing signals intent to customize.
  const startEdit = (p: SerializedEventPromotion) => {
    setEditing({
      id: p.id,
      name: p.name,
      discountType: p.discountType,
      discountValue: p.discountValue !== null ? String(p.discountValue) : "",
      inheritFromParent: false,
      enablePromoCode: p.enablePromoCode,
      promoCode: p.promoCode ?? "",
      conditions: p.conditions,
    });
    if (p.inheritFromParent) {
      toast.info(
        "Editing will turn off inheritance from the parent template. Re-enable the toggle before saving to keep it on.",
      );
    }
  };

  // Cancels the inline edit without saving.
  const cancelEdit = () => setEditing(null);

  // Updates a single condition rule field at the given index.
  const updateCondition = (
    idx: number,
    key: keyof SerializedEventPromotionCondition,
    value: string,
  ) => {
    setEditing((prev) => {
      if (!prev) return prev;
      const updated = [...prev.conditions];
      updated[idx] = { ...updated[idx], [key]: value };
      return { ...prev, conditions: updated };
    });
  };

  // Adds a blank condition rule row to the editor.
  const addCondition = () => {
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            conditions: [
              ...prev.conditions,
              { field: "", operator: "", value: "" },
            ],
          }
        : prev,
    );
  };

  // Removes the condition rule at the given index.
  const removeCondition = (idx: number) => {
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            conditions: prev.conditions.filter((_, i) => i !== idx),
          }
        : prev,
    );
  };

  // Submits the inline edit to POST /api/dashboard/events/[eventId]/promotions/[id].
  // Only this event's subcollection doc is updated — the parent template is untouched.
  const saveEdit = async () => {
    if (!editing) return;

    // When promo code mode is on, require a non-empty code before saving.
    if (editing.enablePromoCode && !editing.promoCode.trim()) {
      toast.error("Promo code is required when 'Enable promo code' is on.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        `/api/dashboard/events/${eventId}/promotions/${editing.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editing.name,
            discountType: editing.discountType,
            discountValue:
              editing.discountValue === "" ? null : editing.discountValue,
            // Send the edited conditions — may differ from the template when not inheriting.
            conditions: editing.conditions,
            inheritFromParent: editing.inheritFromParent,
            enablePromoCode: editing.enablePromoCode,
            // Clear promoCode on the server when promo code mode is turned off.
            promoCode: editing.enablePromoCode
              ? editing.promoCode.trim()
              : null,
          }),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      toast.success("Promotion updated");
      setEditing(null);
      refresh();
    } catch {
      toast.error("Failed to update promotion", {
        description: "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Detaches a promotion from the event by calling DELETE on the subcollection doc.
  // The parent PromotionTemplate is not affected.
  const handleDetach = async (promotionId: string, name: string) => {
    if (!confirm(`Detach "${name}" from this event?`)) return;

    setDeletingId(promotionId);
    try {
      const res = await fetch(
        `/api/dashboard/events/${eventId}/promotions/${promotionId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await res.text());
      toast.success("Promotion detached");
      refresh();
    } catch {
      toast.error("Failed to detach promotion", {
        description: "Please try again.",
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
      <CardHeader className="px-6 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
              Promotions
            </CardDescription>
            <CardTitle className="mt-2 text-2xl text-slate-950">
              Event-level promotion settings
            </CardTitle>
            <CardDescription className="mt-2 text-sm leading-7 text-slate-600">
              Each promotion is a copy of a template. Editing here only affects
              this event. Toggle &quot;Inherit from parent&quot; to allow the
              template owner to push future updates to this event.
            </CardDescription>
          </div>
          <Button className="rounded-full" onClick={() => setAttachOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Attach template
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-6 pb-6 pt-0">
        {promotions.length === 0 ? (
          <p className="text-sm text-slate-500">
            No promotions attached to this event yet.
          </p>
        ) : (
          promotions.map((promotion) => {
            const isEditing = editing?.id === promotion.id;
            const isDeleting = deletingId === promotion.id;

            return (
              <div
                key={promotion.id}
                className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4"
              >
                {isEditing ? (
                  // Inline edit form — only edits this event's copy of the promotion.
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-500">Name</Label>
                      <Input
                        value={editing.name}
                        onChange={(e) =>
                          setEditing((prev) =>
                            prev ? { ...prev, name: e.target.value } : prev,
                          )
                        }
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">
                          Discount Type
                        </Label>
                        <Input
                          placeholder="Flat or Percentage"
                          value={editing.discountType}
                          onChange={(e) =>
                            setEditing((prev) =>
                              prev
                                ? { ...prev, discountType: e.target.value }
                                : prev,
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">
                          Discount Value
                        </Label>
                        <Input
                          type="number"
                          placeholder="e.g. 20"
                          value={editing.discountValue}
                          onChange={(e) =>
                            setEditing((prev) =>
                              prev
                                ? { ...prev, discountValue: e.target.value }
                                : prev,
                            )
                          }
                        />
                      </div>
                    </div>

                    {/* Promo code toggle — switch on to require attendees to enter a code. */}
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            Enable promo code
                          </p>
                          <p className="text-xs text-slate-500">
                            {editing.enablePromoCode
                              ? "Attendees must enter the code to claim the discount."
                              : "Discount auto-applies when conditions are met."}
                          </p>
                        </div>
                        <Switch
                          checked={editing.enablePromoCode}
                          onCheckedChange={(checked) =>
                            setEditing((prev) =>
                              prev
                                ? { ...prev, enablePromoCode: checked }
                                : prev,
                            )
                          }
                        />
                      </div>
                      {/* Show the code input only when promo code mode is active. */}
                      {editing.enablePromoCode && (
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-500">
                            Promo Code
                          </Label>
                          <Input
                            placeholder="e.g. SG60"
                            value={editing.promoCode}
                            onChange={(e) =>
                              setEditing((prev) =>
                                prev
                                  ? { ...prev, promoCode: e.target.value }
                                  : prev,
                              )
                            }
                          />
                        </div>
                      )}
                    </div>

                    {/* Conditions section — always editable regardless of inheritance state. */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-950">
                          Conditions
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full text-xs"
                          onClick={addCondition}
                        >
                          + Add condition
                        </Button>
                      </div>

                      {editing.conditions.length === 0 ? (
                        <p className="text-xs text-slate-400">
                          No conditions — discount applies to all attendees.
                        </p>
                      ) : (
                        // Editable condition rows — each row has field, operator, value.
                        editing.conditions.map((cond, idx) => (
                          <div
                            key={idx}
                            className="grid grid-cols-12 gap-2 rounded-xl border border-slate-200 bg-white p-3"
                          >
                            <div className="col-span-4 space-y-1">
                              <Label className="text-xs text-slate-500">
                                Field
                              </Label>
                              <Select
                                value={cond.field}
                                onValueChange={(v) =>
                                  updateCondition(idx, "field", v)
                                }
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
                              <Label className="text-xs text-slate-500">
                                Operator
                              </Label>
                              <Select
                                value={cond.operator}
                                onValueChange={(v) =>
                                  updateCondition(idx, "operator", v)
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Operator" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="=">=</SelectItem>
                                  <SelectItem value="!=">≠</SelectItem>
                                  <SelectItem value=">">&gt;</SelectItem>
                                  <SelectItem value="<">&lt;</SelectItem>
                                  <SelectItem value=">=">&gt;=</SelectItem>
                                  <SelectItem value="<=">&lt;=</SelectItem>
                                  <SelectItem value="contains">
                                    contains
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="col-span-3 space-y-1">
                              <Label className="text-xs text-slate-500">
                                Value
                              </Label>
                              <Input
                                placeholder="e.g. 18"
                                value={String(cond.value ?? "")}
                                onChange={(e) =>
                                  updateCondition(idx, "value", e.target.value)
                                }
                              />
                            </div>

                            <div className="col-span-1 flex items-end justify-end">
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => removeCondition(idx)}
                              >
                                ×
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Toggle to re-enable parent template control after customizing. */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <Switch
                          id={`inherit-${promotion.id}`}
                          checked={editing.inheritFromParent}
                          onCheckedChange={(checked) =>
                            setEditing((prev) =>
                              prev
                                ? { ...prev, inheritFromParent: checked }
                                : prev,
                            )
                          }
                        />
                        <Label
                          htmlFor={`inherit-${promotion.id}`}
                          className="text-sm text-slate-700"
                        >
                          Inherit from parent template
                        </Label>
                      </div>
                      <p className="pl-11 text-xs text-slate-400">
                        Turning this on lets the template owner push future
                        updates to this event&apos;s promotion.
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="rounded-full"
                        onClick={saveEdit}
                        disabled={saving}
                      >
                        {saving ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={cancelEdit}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  // Read-only view of the event-level promotion.
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-950">
                        {promotion.name}
                      </p>

                      {/* Discount summary line */}
                      <p className="text-xs text-slate-500">
                        {promotion.discountType || "—"} ·{" "}
                        {promotion.discountValue !== null
                          ? promotion.discountValue
                          : "—"}
                      </p>

                      {/* Redemption mode badge: promo code required vs. auto-apply */}
                      {promotion.enablePromoCode ? (
                        <Badge
                          variant="outline"
                          className="gap-1 border-orange-200 bg-orange-50 text-orange-700"
                        >
                          <Tag className="h-3 w-3" />
                          Code: {promotion.promoCode}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700"
                        >
                          <Zap className="h-3 w-3" />
                          Auto-apply
                        </Badge>
                      )}

                      {/* Conditions — always visible so the state is transparent at a glance. */}
                      <div className="flex flex-wrap gap-1 pt-1">
                        {promotion.conditions.length > 0 ? (
                          promotion.conditions.map((rule, idx) => (
                            <Badge
                              key={idx}
                              variant="secondary"
                              className="text-xs font-normal"
                            >
                              {formatConditionRule(rule)}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">
                            No conditions — applies to all attendees
                          </span>
                        )}
                      </div>

                      {promotion.inheritFromParent ? (
                        <p className="text-xs text-slate-400">
                          Inherits from parent — template updates apply here
                        </p>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 text-amber-700"
                        >
                          Custom — not inheriting from template
                        </Badge>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => startEdit(promotion)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="rounded-full"
                        onClick={() =>
                          handleDetach(promotion.id, promotion.name)
                        }
                        disabled={isDeleting}
                      >
                        {isDeleting ? "Removing…" : "Detach"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>

      {/* Dialog for selecting which org template to attach to this event. */}
      <AttachPromotionDialog
        open={attachOpen}
        eventId={eventId}
        availableTemplates={availableTemplates}
        attachedTemplateIds={attachedTemplateIds}
        onOpenChange={setAttachOpen}
        onAttached={refresh}
      />
    </Card>
  );
}
