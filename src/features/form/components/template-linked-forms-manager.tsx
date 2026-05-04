"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface LinkedFormSummary {
  id: string;
  title: string;
  eventId: string;
  eventName: string;
  eventStatus: "Draft" | "Published";
  formStatus: "draft" | "published";
  templateVersion: number;
  detached: boolean;
  updateAvailable: boolean;
}

interface TemplateLinkedFormsManagerProps {
  templateId: string;
  templateVersion: number;
  linkedForms: LinkedFormSummary[];
}

export function TemplateLinkedFormsManager({
  templateId,
  templateVersion,
  linkedForms,
}: TemplateLinkedFormsManagerProps) {
  const router = useRouter();
  const [selectedFormIds, setSelectedFormIds] = useState<string[]>(
    linkedForms.filter((form) => form.updateAvailable).map((form) => form.id),
  );
  const [isApplying, setIsApplying] = useState<"all" | "selected" | null>(null);

  const updatableForms = useMemo(
    () =>
      linkedForms.filter((form) => !form.detached && form.updateAvailable),
    [linkedForms],
  );

  function toggleSelection(formId: string) {
    setSelectedFormIds((currentIds) =>
      currentIds.includes(formId)
        ? currentIds.filter((id) => id !== formId)
        : [...currentIds, formId],
    );
  }

  async function applyUpdates(mode: "all" | "selected") {
    try {
      setIsApplying(mode);
      const response = await fetch(
        `/api/dashboard/forms/templates/${templateId}/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            formIds: selectedFormIds,
          }),
        },
      );

      const responseText = await response.text();
      const payload = (responseText ? JSON.parse(responseText) : {}) as {
        error?: string;
        updatedCount?: number;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to apply template updates");
      }

      toast.success("Template updates applied", {
        description: `Updated ${payload.updatedCount ?? 0} linked form(s) to version ${templateVersion}.`,
      });
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("Unable to apply template updates", {
        description: "Please try again in a moment.",
      });
    } finally {
      setIsApplying(null);
    }
  }

  return (
    <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
      <CardHeader className="px-6 pt-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <CardTitle className="text-2xl text-slate-950">
              Linked event forms
            </CardTitle>
            <CardDescription className="mt-2">
              Apply this template version to some or all linked event forms. Live published events remain eligible, so review carefully before applying changes broadly.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              disabled={!updatableForms.length || isApplying !== null}
              onClick={() => applyUpdates("selected")}
            >
              {isApplying === "selected" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Applying
                </>
              ) : (
                "Apply to selected"
              )}
            </Button>
            <Button
              type="button"
              className="rounded-full"
              disabled={!updatableForms.length || isApplying !== null}
              onClick={() => applyUpdates("all")}
            >
              {isApplying === "all" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Applying
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Apply to all linked forms
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-6 pb-6 pt-0">
        {linkedForms.length ? (
          linkedForms.map((form) => (
            <label
              key={form.id}
              className="flex gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4"
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-[#ff7a59]"
                checked={selectedFormIds.includes(form.id)}
                disabled={!form.updateAvailable || form.detached}
                onChange={() => toggleSelection(form.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      {form.eventName}
                    </p>
                    <p className="text-sm text-slate-600">{form.title}</p>
                  </div>
                  <Link
                    href={`/dashboard/events/${form.eventId}/form`}
                    className="text-sm font-medium text-orange-900 underline-offset-4 hover:underline"
                  >
                    Open form
                  </Link>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>Event: {form.eventStatus}</span>
                  <span>Form: {form.formStatus}</span>
                  <span>Linked version: {form.templateVersion}</span>
                  <span>
                    {form.detached
                      ? "Detached"
                      : form.updateAvailable
                        ? "Update available"
                        : "Up to date"}
                  </span>
                </div>
              </div>
            </label>
          ))
        ) : (
          <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-600">
            No linked event forms yet. Once organizers create event forms from this template, they will appear here for update management.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
