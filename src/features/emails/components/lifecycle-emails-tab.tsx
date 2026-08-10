"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmationPreviewCard } from "@/features/emails/components/confirmation-preview-card";
import { DeleteEntityDialog } from "@/features/registration/components/delete-entity-dialog";
import { EmailActiveSwitch } from "@/features/emails/components/email-active-switch";
import { EntityTableError } from "@/features/registration/components/entity-table-states";
import type {
  RenderedEmailPreview,
  SerializedEmailDefinition,
} from "@/features/emails/types";
import {
  describeEmailAudience,
  emailBodyModeLabel,
  emailDeliveryLabel,
  EMAIL_AUDIENCE_LABELS,
  EMAIL_GROUP_OPTIONS,
  EMAIL_GROUP_SECTION_COPY,
  summarizeEmailDefinition,
  triggerDisplayLabel,
} from "@/features/emails/utils";
import { cn } from "@/lib/utils";

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

type LifecycleGroupFilter = "all" | SerializedEmailDefinition["group"];

interface EmailPlanRowProps {
  definition: SerializedEmailDefinition;
  timeZone: string;
  selected: boolean;
  checked: boolean;
  disabled: boolean;
  onSelect: (kind: string) => void;
  onToggle: (definition: SerializedEmailDefinition) => void;
  onOpenEditor: (kind: string) => void;
  onDeleteCustom: (definition: SerializedEmailDefinition) => void;
}

interface SelectedEmailPanelProps {
  definition: SerializedEmailDefinition;
  timeZone: string;
  checked: boolean;
  confirmationPreview:
    | (RenderedEmailPreview & { qrSvg: string | null; isRealAttendee: boolean })
    | null;
  onOpenEditor: (kind: string) => void;
  onDeleteCustom: (definition: SerializedEmailDefinition) => void;
}

function EmailPlanRow({
  definition,
  timeZone,
  selected,
  checked,
  disabled,
  onSelect,
  onToggle,
  onOpenEditor,
  onDeleteCustom,
}: EmailPlanRowProps) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        selected && "border-foreground bg-muted/25 shadow-sm",
      )}
      data-email-row={definition.kind}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onSelect(definition.kind)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {definition.name}
            </span>
            {selected ? <Badge variant="secondary">Viewing</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {triggerDisplayLabel(definition.trigger, timeZone)} ·{" "}
            {EMAIL_AUDIENCE_LABELS[definition.audience]}
          </p>
        </button>

        <EmailActiveSwitch
          name={definition.name}
          checked={checked}
          disabled={disabled}
          onCheckedChange={() => onToggle(definition)}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="outline">{emailDeliveryLabel(definition.trigger)}</Badge>
        <Badge variant="outline">{emailBodyModeLabel(definition.bodyMode)}</Badge>
        <Button
          variant={selected ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onSelect(definition.kind)}
        >
          {selected ? "Selected" : "View"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenEditor(definition.kind)}
        >
          Edit
        </Button>
        {!definition.isSystem ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Delete ${definition.name}`}
            onClick={() => onDeleteCustom(definition)}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SelectedEmailPanel({
  definition,
  timeZone,
  checked,
  confirmationPreview,
  onOpenEditor,
  onDeleteCustom,
}: SelectedEmailPanelProps) {
  const detailSummary = summarizeEmailDefinition(definition, timeZone);
  const isConfirmationPreview =
    definition.kind === "confirmation-paid" && confirmationPreview !== null;
  const bodyCopy = definition.body.trim();

  return (
    <div className="xl:sticky xl:top-6">
      <Card className="rounded-2xl py-0">
        <CardHeader className="gap-3 pb-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Selected email</p>
              <CardTitle className="text-xl">{definition.name}</CardTitle>
              <CardDescription className="max-w-xl text-sm leading-6">
                {detailSummary}
              </CardDescription>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => onOpenEditor(definition.kind)}>
                Edit email
              </Button>
              {!definition.isSystem ? (
                <Button
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${definition.name}`}
                  onClick={() => onDeleteCustom(definition)}
                >
                  <Trash2 aria-hidden="true" />
                  Delete
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant={checked ? "secondary" : "outline"}>
              {checked ? "Live" : "Off"}
            </Badge>
            <Badge variant="outline">{emailDeliveryLabel(definition.trigger)}</Badge>
            <Badge variant="outline">{emailBodyModeLabel(definition.bodyMode)}</Badge>
            <Badge variant="outline">
              {definition.isSystem ? "System email" : "Custom email"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 px-6 py-5">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-muted/20 p-4">
              <dt className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                When it sends
              </dt>
              <dd className="mt-2 text-sm font-medium text-foreground">
                {triggerDisplayLabel(definition.trigger, timeZone)}
              </dd>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <dt className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Who gets it
              </dt>
              <dd className="mt-2 text-sm font-medium text-foreground">
                {EMAIL_AUDIENCE_LABELS[definition.audience]}
              </dd>
              <dd className="mt-1 text-xs leading-5 text-muted-foreground">
                {describeEmailAudience(definition.audience)}
              </dd>
            </div>
          </dl>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Subject</p>
            <div className="rounded-xl border bg-muted/20 px-4 py-3 text-sm font-medium text-foreground">
              {definition.subject || "No subject yet"}
            </div>
          </div>

          {isConfirmationPreview ? (
            <ConfirmationPreviewCard
              preview={confirmationPreview}
              loadError={false}
              onEdit={() => onOpenEditor(definition.kind)}
              title="Preview"
              showEditLink={false}
            />
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Message</p>
              <div className="max-h-[360px] overflow-auto rounded-xl border bg-muted/20 px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-foreground">
                {definition.bodyMode === "blocks" && !bodyCopy
                  ? "This email uses the block designer. Open the editor to review the layout."
                  : bodyCopy || "No body copy yet."}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {definition.materialized
              ? "This email has saved event-specific content."
              : "This email is still using the default event template."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
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
  const [activeGroupFilter, setActiveGroupFilter] =
    useState<LifecycleGroupFilter>("post-registration");
  const [selectedKind, setSelectedKind] = useState<string | null>(
    definitions[0]?.kind ?? null,
  );
  const [togglingKind, setTogglingKind] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SerializedEmailDefinition | null>(
    null,
  );
  const [deletePending, setDeletePending] = useState(false);

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

  const groupedSections = EMAIL_GROUP_OPTIONS.map((group) => ({
    group,
    section: EMAIL_GROUP_SECTION_COPY[group],
    definitions: definitions.filter((definition) => definition.group === group),
  })).filter((entry) => entry.definitions.length > 0);

  useEffect(() => {
    if (definitions.length === 0) {
      setSelectedKind(null);
      return;
    }

    if (!selectedKind || !definitions.some((item) => item.kind === selectedKind)) {
      setSelectedKind(definitions[0]?.kind ?? null);
    }
  }, [definitions, selectedKind]);

  const visibleSections =
    activeGroupFilter === "all"
      ? groupedSections
      : groupedSections.filter((entry) => entry.group === activeGroupFilter);

  useEffect(() => {
    if (groupedSections.length === 0) return;

    if (
      activeGroupFilter !== "all" &&
      !groupedSections.some((entry) => entry.group === activeGroupFilter)
    ) {
      setActiveGroupFilter(groupedSections[0]?.group ?? "all");
    }
  }, [activeGroupFilter, groupedSections]);

  useEffect(() => {
    const visibleDefinitions = visibleSections.flatMap((entry) => entry.definitions);
    if (visibleDefinitions.length === 0) return;

    if (!selectedKind || !visibleDefinitions.some((item) => item.kind === selectedKind)) {
      setSelectedKind(visibleDefinitions[0]?.kind ?? null);
    }
  }, [selectedKind, visibleSections]);

  const selectedDefinition =
    visibleSections
      .flatMap((entry) => entry.definitions)
      .find((definition) => definition.kind === selectedKind) ??
    visibleSections[0]?.definitions[0] ??
    definitions[0] ??
    null;

  if (loadError) {
    return (
      <EntityTableError
        entityLabel="lifecycle emails"
        onRetry={() => router.refresh()}
      />
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
      <div className="space-y-4">
        <Card className="rounded-2xl py-0">
          <CardContent className="space-y-3 px-6 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={activeGroupFilter === "all" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setActiveGroupFilter("all")}
              >
                All
                <Badge variant="outline" className="ml-1">
                  {definitions.length}
                </Badge>
              </Button>
              {groupedSections.map(({ group, section, definitions: sectionDefinitions }) => (
                <Button
                  key={group}
                  variant={activeGroupFilter === group ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setActiveGroupFilter(group)}
                >
                  {section.title}
                  <Badge variant="outline" className="ml-1">
                    {sectionDefinitions.length}
                  </Badge>
                </Button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Switch phases to focus on one part of the attendee journey at a time.
            </p>
          </CardContent>
        </Card>

        {visibleSections.map(({ group, section, definitions: sectionDefinitions }) => (
          <Card key={group} className="rounded-2xl py-0">
            <CardHeader className="pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-lg">{section.title}</CardTitle>
                  <CardDescription className="text-sm">
                    {section.description}
                  </CardDescription>
                </div>
                <Badge variant="outline">{sectionDefinitions.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-6 py-5">
              {sectionDefinitions.map((definition) => (
                <EmailPlanRow
                  key={definition.kind}
                  definition={definition}
                  timeZone={timeZone}
                  selected={selectedDefinition?.kind === definition.kind}
                  checked={activeOverrides[definition.kind] ?? definition.enabled}
                  disabled={togglingKind === definition.kind}
                  onSelect={setSelectedKind}
                  onToggle={handleToggle}
                  onOpenEditor={onOpenEditor}
                  onDeleteCustom={(value) => setDeleting(value)}
                />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedDefinition ? (
        <SelectedEmailPanel
          definition={selectedDefinition}
          timeZone={timeZone}
          checked={activeOverrides[selectedDefinition.kind] ?? selectedDefinition.enabled}
          confirmationPreview={confirmationPreview}
          onOpenEditor={onOpenEditor}
          onDeleteCustom={(value) => setDeleting(value)}
        />
      ) : null}

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
