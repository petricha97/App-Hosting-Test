"use client";

// Emails screen shell (design §0) — header + CTA row, meta line, Lifecycle
// emails / Send log tabs (?tab= URL sync, pricing-workspace.tsx precedent).
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmailDefinitionPickerMenu } from "@/features/emails/components/email-definition-picker-menu";
import { EmailEditorDialog } from "@/features/emails/components/email-editor-dialog";
import { EmailsMetaBar } from "@/features/emails/components/emails-meta-bar";
import { LifecycleEmailsTab } from "@/features/emails/components/lifecycle-emails-tab";
import { SenderSettingsDialog } from "@/features/emails/components/sender-settings-dialog";
import { SendLogTab } from "@/features/emails/components/send-log-tab";
import type {
  EmailBodyMode,
  EmailComposerTokenSection,
  RenderedEmailPreview,
  SerializedEmailDefinition,
  SerializedEmailMessage,
  SerializedEmailSettings,
} from "@/features/emails/types";
import {
  buildDefinitionsByKind,
  resolveEmailWorkspaceEditorState,
  resolveEmailWorkspaceTab,
} from "@/features/emails/utils";

interface EmailsWorkspaceProps {
  eventId: string;
  timeZone: string;
  initialTab: "lifecycle" | "log";
  definitions: SerializedEmailDefinition[];
  settings: SerializedEmailSettings;
  tokenSections: EmailComposerTokenSection[];
  confirmationPreview:
    | (RenderedEmailPreview & { qrSvg: string | null; isRealAttendee: boolean })
    | null;
  initialLog: {
    messages: SerializedEmailMessage[];
    count: number;
    nextCursor: number | null;
  };
  loadError: boolean;
  initialEditorKind: string | null;
  initialEditorCreate: boolean;
  initialEditorMode?: EmailBodyMode;
}

export function EmailsWorkspace({
  eventId,
  timeZone,
  initialTab,
  definitions,
  settings: initialSettings,
  tokenSections,
  confirmationPreview,
  initialLog,
  loadError,
  initialEditorKind,
  initialEditorCreate,
  initialEditorMode,
}: EmailsWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(initialTab);
  const [settings, setSettings] = useState(initialSettings);
  const [editingKind, setEditingKind] = useState<string | null>(initialEditorKind);
  const [isCreateMode, setIsCreateMode] = useState(initialEditorCreate);
  const [forceInitialMode, setForceInitialMode] = useState<
    EmailBodyMode | undefined
  >(initialEditorMode);
  const [senderSettingsOpen, setSenderSettingsOpen] = useState(false);

  useEffect(() => {
    const next = resolveEmailWorkspaceTab(searchParams.get("tab"));
    setTab(next);
  }, [searchParams]);

  useEffect(() => {
    const next = resolveEmailWorkspaceEditorState({
      editor: searchParams.get("editor"),
      editorMode: searchParams.get("editorMode"),
    });
    setEditingKind(next.kind);
    setIsCreateMode(next.isCreate);
    setForceInitialMode(next.forceInitialMode);
  }, [searchParams]);

  const setWorkspaceParams = (
    updates: Partial<Record<"tab" | "editor" | "editorMode", string | null>>,
  ) => {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (value && value.length > 0) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const handleTabChange = (value: string) => {
    const next = resolveEmailWorkspaceTab(value);
    setTab(next);
    setWorkspaceParams({ tab: next });
  };

  const openEditor = (kind: string) => {
    setEditingKind(kind);
    setIsCreateMode(false);
    setForceInitialMode(undefined);
    setWorkspaceParams({ editor: kind, editorMode: null });
  };

  const openCreate = () => {
    setEditingKind(null);
    setIsCreateMode(true);
    setForceInitialMode(undefined);
    setWorkspaceParams({ editor: "new", editorMode: null });
  };

  // M6-T4 (design §1) — the ONLY entry point that forces the mode toggle to
  // "Block designer"; ordinary row-click editing (openEditor above) keeps
  // defaulting to the definition's persisted bodyMode.
  const openBlockDesigner = (kind: string) => {
    setEditingKind(kind);
    setIsCreateMode(false);
    setForceInitialMode("blocks");
    setWorkspaceParams({ editor: kind, editorMode: "blocks" });
  };

  const definitionsByKind = buildDefinitionsByKind(definitions);
  const editingDefinition = useMemo(
    () => (editingKind !== null ? (definitionsByKind.get(editingKind) ?? null) : null),
    [definitionsByKind, editingKind],
  );
  const showEditor = isCreateMode || editingDefinition !== null;
  const automatedCount = definitions.filter(
    (definition) => definition.trigger.type !== "manual",
  ).length;
  const customCount = definitions.filter(
    (definition) => !definition.isSystem,
  ).length;

  return (
    <div className="space-y-6">
      {showEditor ? (
        <EmailEditorDialog
          open={showEditor}
          onOpenChange={(next) => {
            if (next) return;
            setEditingKind(null);
            setIsCreateMode(false);
            setForceInitialMode(undefined);
            setWorkspaceParams({ editor: null, editorMode: null });
          }}
          eventId={eventId}
          timeZone={timeZone}
          definitionsByKind={definitionsByKind}
          definition={isCreateMode ? null : editingDefinition}
          tokenSections={tokenSections}
          onSaved={() => {
            setEditingKind(null);
            setIsCreateMode(false);
            setForceInitialMode(undefined);
            setWorkspaceParams({ editor: null, editorMode: null });
            router.refresh();
          }}
          forceInitialMode={forceInitialMode}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">Event emails</h1>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{definitions.length} emails</Badge>
                <Badge variant="outline">{automatedCount} automated</Badge>
                {customCount > 0 ? (
                  <Badge variant="outline">{customCount} custom</Badge>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <EmailDefinitionPickerMenu
                definitions={definitions}
                timeZone={timeZone}
                onSelect={openBlockDesigner}
              />
              <Button onClick={openCreate}>
                <Plus aria-hidden="true" />
                New custom email
              </Button>
            </div>
          </div>

          <EmailsMetaBar
            settings={settings}
            tokenSections={tokenSections}
            onOpenSenderSettings={() => setSenderSettingsOpen(true)}
          />

          <Tabs value={tab} onValueChange={handleTabChange} className="gap-4">
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="lifecycle">Email plan</TabsTrigger>
              <TabsTrigger value="log">Send history</TabsTrigger>
            </TabsList>

            <TabsContent value="lifecycle">
              <LifecycleEmailsTab
                eventId={eventId}
                timeZone={timeZone}
                definitions={definitions}
                confirmationPreview={confirmationPreview}
                loadError={loadError}
                onOpenEditor={openEditor}
              />
            </TabsContent>
            <TabsContent value="log">
              {loadError ? null : (
                <SendLogTab
                  eventId={eventId}
                  definitions={definitions}
                  definitionsByKind={definitionsByKind}
                  initialMessages={initialLog.messages}
                  initialCount={initialLog.count}
                  initialNextCursor={initialLog.nextCursor}
                />
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      <SenderSettingsDialog
        open={senderSettingsOpen}
        onOpenChange={setSenderSettingsOpen}
        eventId={eventId}
        settings={settings}
        onSaved={(next) => {
          setSettings(next);
          router.refresh();
        }}
      />
    </div>
  );
}
