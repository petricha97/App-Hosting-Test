"use client";

// Emails screen shell (design §0) — header + CTA row, meta line, Lifecycle
// emails / Send log tabs (?tab= URL sync, pricing-workspace.tsx precedent).
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EmailEditorDialog } from "@/features/emails/components/email-editor-dialog";
import { EmailsMetaBar } from "@/features/emails/components/emails-meta-bar";
import { LifecycleEmailsTab } from "@/features/emails/components/lifecycle-emails-tab";
import { SenderSettingsDialog } from "@/features/emails/components/sender-settings-dialog";
import { SendLogTab } from "@/features/emails/components/send-log-tab";
import type {
  RenderedEmailPreview,
  SerializedEmailDefinition,
  SerializedEmailMessage,
  SerializedEmailSettings,
} from "@/features/emails/types";
import {
  buildDefinitionsByKind,
  resolveEmailWorkspaceTab,
} from "@/features/emails/utils";

interface EmailsWorkspaceProps {
  eventId: string;
  timeZone: string;
  initialTab: "lifecycle" | "log";
  definitions: SerializedEmailDefinition[];
  settings: SerializedEmailSettings;
  confirmationPreview:
    | (RenderedEmailPreview & { qrSvg: string | null; isRealAttendee: boolean })
    | null;
  initialLog: {
    messages: SerializedEmailMessage[];
    count: number;
    nextCursor: number | null;
  };
  loadError: boolean;
}

export function EmailsWorkspace({
  eventId,
  timeZone,
  initialTab,
  definitions,
  settings: initialSettings,
  confirmationPreview,
  initialLog,
  loadError,
}: EmailsWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState(initialTab);
  const [settings, setSettings] = useState(initialSettings);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingKind, setEditingKind] = useState<string | null>(null);
  const [senderSettingsOpen, setSenderSettingsOpen] = useState(false);

  const handleTabChange = (value: string) => {
    const next = resolveEmailWorkspaceTab(value);
    setTab(next);
    router.replace(`${pathname}?tab=${next}`, { scroll: false });
  };

  const openEditor = (kind: string) => {
    setEditingKind(kind);
    setEditorOpen(true);
  };

  const openCreate = () => {
    setEditingKind(null);
    setEditorOpen(true);
  };

  const definitionsByKind = buildDefinitionsByKind(definitions);
  const editingDefinition =
    editingKind !== null ? (definitionsByKind.get(editingKind) ?? null) : null;
  // An open dialog with no matching definition (create mode) is
  // distinguished from "editing a known kind" by editorOpen + editingKind.
  const isCreateMode = editorOpen && editingKind === null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Emails</h1>
          <p className="text-sm text-muted-foreground">
            Lifecycle-triggered messages your registrants receive automatically
            or on demand.
          </p>
        </div>
        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button variant="outline" disabled>
                  Open Email Designer
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Email designer arrives with M6-T4</TooltipContent>
          </Tooltip>
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" />
            Create email
          </Button>
        </div>
      </div>

      <EmailsMetaBar
        settings={settings}
        onOpenSenderSettings={() => setSenderSettingsOpen(true)}
      />

      <Tabs value={tab} onValueChange={handleTabChange} className="gap-6">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="lifecycle">Lifecycle emails</TabsTrigger>
          <TabsTrigger value="log">Send log</TabsTrigger>
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

      <EmailEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        eventId={eventId}
        timeZone={timeZone}
        definitionsByKind={definitionsByKind}
        definition={isCreateMode ? null : editingDefinition}
        onSaved={() => router.refresh()}
      />

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
