"use client";

// Lifecycle emails tab (design §1) — Pre-event / Post-registration groups,
// then the debt-chase table + confirmation preview card in a 2-col grid
// (stacks below lg, spec §1 AC-7). Zero-write guarantee (§1 AC-1) means
// there is no empty state distinct from "8 default rows" — a fresh event
// always shows the full virtual catalog.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ConfirmationPreviewCard } from "@/features/emails/components/confirmation-preview-card";
import { DeleteEntityDialog } from "@/features/registration/components/delete-entity-dialog";
import { EmailGroupTable } from "@/features/emails/components/email-group-table";
import { EntityTableError } from "@/features/registration/components/entity-table-states";
import type {
  RenderedEmailPreview,
  SerializedEmailDefinition,
} from "@/features/emails/types";

interface LifecycleEmailsTabProps {
  eventId: string;
  timeZone: string;
  definitions: SerializedEmailDefinition[];
  confirmationPreview:
    | (RenderedEmailPreview & { qrSvg: string | null; isRealAttendee: boolean })
    | null;
  loadError: boolean;
  onOpenEditor: (kind: string) => void;
}

export function LifecycleEmailsTab({
  eventId,
  timeZone,
  definitions,
  confirmationPreview,
  loadError,
  onOpenEditor,
}: LifecycleEmailsTabProps) {
  const router = useRouter();
  const [activeOverrides, setActiveOverrides] = useState<
    Record<string, boolean>
  >({});
  const [togglingKind, setTogglingKind] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SerializedEmailDefinition | null>(
    null,
  );
  const [deletePending, setDeletePending] = useState(false);

  if (loadError) {
    return (
      <EntityTableError
        entityLabel="lifecycle emails"
        onRetry={() => router.refresh()}
      />
    );
  }

  const definitionUrl = (kind: string) =>
    `/api/dashboard/events/${encodeURIComponent(eventId)}/emails/definitions/${encodeURIComponent(kind)}`;

  const handleToggle = async (definition: SerializedEmailDefinition) => {
    const nextEnabled = !(
      activeOverrides[definition.kind] ?? definition.enabled
    );
    setTogglingKind(definition.kind);
    setActiveOverrides((current) => ({
      ...current,
      [definition.kind]: nextEnabled,
    }));

    const rollback = () =>
      setActiveOverrides((current) => {
        const next = { ...current };
        delete next[definition.kind];
        return next;
      });

    try {
      const response = await fetch(definitionUrl(definition.kind), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });

      if (!response.ok) {
        rollback();
        toast.error("Failed to update the email.");
        return;
      }

      router.refresh();
    } catch {
      rollback();
      toast.error("Failed to update the email.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setTogglingKind(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletePending(true);
    try {
      const response = await fetch(definitionUrl(deleting.kind), {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        toast.error(
          typeof data?.error === "string"
            ? data.error
            : "Failed to delete the email.",
        );
        return;
      }
      toast.success("Email deleted");
      setDeleting(null);
      router.refresh();
    } catch {
      toast.error("Failed to delete the email.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setDeletePending(false);
    }
  };

  const groupDefinitions = (group: SerializedEmailDefinition["group"]) =>
    definitions.filter((definition) => definition.group === group);

  const tableProps = {
    timeZone,
    activeOverrides,
    togglingKind,
    onToggle: handleToggle,
    onOpenEditor,
    onDeleteCustom: (definition: SerializedEmailDefinition) =>
      setDeleting(definition),
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Pre-event</h2>
        <EmailGroupTable
          ariaLabel="Pre-event emails"
          columns="4col"
          definitions={groupDefinitions("pre-event")}
          {...tableProps}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Post-registration
        </h2>
        <EmailGroupTable
          ariaLabel="Post-registration emails"
          columns="4col"
          definitions={groupDefinitions("post-registration")}
          {...tableProps}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            Debt chase &amp; countdown
          </h2>
          <EmailGroupTable
            ariaLabel="Debt chase and countdown emails"
            columns="3col"
            definitions={groupDefinitions("debt-chase")}
            {...tableProps}
          />
        </div>
        <ConfirmationPreviewCard
          preview={confirmationPreview}
          loadError={loadError}
          onEdit={() => onOpenEditor("confirmation-paid")}
        />
      </div>

      <DeleteEntityDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? "email"}?`}
        description="This removes the custom email permanently. Its send history is kept."
        blockedMessage={null}
        pending={deletePending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
