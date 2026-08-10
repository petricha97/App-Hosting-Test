// Emails screen (M6-T2). Server Component: verifies org ownership (404 on
// cross-org), fetches merged lifecycle definitions + sender settings + the
// confirmation-paid preview + the first send-log page, and renders the
// client workspace. Server page gates ORG MEMBERSHIP ONLY (M5 L-4
// convention) — every mutating/reading API call the client makes re-gates
// write:events itself.
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { mergeEmailDefinitions } from "@/features/emails/default-definitions";
import { EmailsWorkspace } from "@/features/emails/components/emails-workspace";
import { renderEmailDefinitionPreview } from "@/features/emails/server/render";
import { resolveEmailBlockRenderContext } from "@/features/emails/server/resolve-block-context";
import { loadSampleEmailContext } from "@/features/emails/server/sample-context";
import { serializeEmailMessage } from "@/features/emails/server/serialize";
import {
  attachEmailTemplateVariables,
  buildEmailComposerTokenSections,
  loadEmailTemplateVariableSource,
} from "@/features/emails/server/template-variables";
import type {
  EmailComposerTokenSection,
  RenderedEmailPreview,
  SerializedEmailSettings,
} from "@/features/emails/types";
import {
  resolveEmailWorkspaceEditorState,
  resolveEmailWorkspaceTab,
} from "@/features/emails/utils";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { resolveEventTimeZone } from "@/features/registration/utils";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import {
  countAdminEmailMessagesForEvent,
  EMAIL_MESSAGE_LIST_LIMIT,
  listAdminEmailMessagesForEvent,
} from "@/lib/db/adminEmailMessage";
import { listAdminEmailDefinitionsForEvent } from "@/lib/db/adminEmailDefinition";
import { getAdminEmailSettingsForEvent } from "@/lib/db/adminEmailSettings";
import { resolveEmailSenderIdentity } from "@/lib/email/sender-identity";

export const metadata: Metadata = {
  title: "Emails | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{
    tab?: string | string[];
    editor?: string | string[];
    editorMode?: string | string[];
  }>;
}

export default async function EventEmailsPage({
  params,
  searchParams,
}: PageProps) {
  const [{ eventId }, { tab, editor, editorMode }] = await Promise.all([
    params,
    searchParams,
  ]);
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(
    eventId,
    scope.organizationId,
  );

  if (!event) {
    notFound();
  }

  const timeZone = resolveEventTimeZone(event.timezone);

  let loadError = false;
  let definitions: ReturnType<typeof mergeEmailDefinitions> = [];
  let settings: SerializedEmailSettings = {
    fromName: event.name,
    fromAddress: "",
    replyTo: null,
    source: "defaults",
    hasStoredDoc: false,
  };
  let confirmationPreview:
    | (RenderedEmailPreview & {
        qrSvg: string | null;
        isRealAttendee: boolean;
      })
    | null = null;
  let initialLog: {
    messages: ReturnType<typeof serializeEmailMessage>[];
    count: number;
    nextCursor: number | null;
  } = { messages: [], count: 0, nextCursor: null };
  let tokenSections: EmailComposerTokenSection[] = [];

  try {
    const [
      storedDefinitions,
      identity,
      storedSettings,
      sample,
      logRows,
      logCount,
      blockContext,
      variableSource,
    ] = await Promise.all([
      listAdminEmailDefinitionsForEvent({
        eventId,
        organizationId: scope.organizationId,
      }),
      resolveEmailSenderIdentity({
        eventId,
        organizationId: scope.organizationId,
        eventName: event.name,
      }),
      getAdminEmailSettingsForEvent({
        eventId,
        organizationId: scope.organizationId,
      }),
      loadSampleEmailContext({
        eventId,
        organizationId: scope.organizationId,
        event,
      }),
      listAdminEmailMessagesForEvent({
        eventId,
        organizationId: scope.organizationId,
      }),
      countAdminEmailMessagesForEvent({
        eventId,
        organizationId: scope.organizationId,
      }),
      // M6-T4 B-1 fix: same live pricing/registration/countdown data the
      // editor's own preview route now resolves — this confirmation-preview
      // card renders through the SAME render pipeline, so it needs the same
      // context to show real RegistrationEmbed/TicketPricingTable/
      // CountdownTimer content rather than always the empty-state fallback.
      resolveEmailBlockRenderContext({
        eventId,
        organizationId: scope.organizationId,
      }),
      loadEmailTemplateVariableSource({
        organizationId: scope.organizationId,
        event,
      }),
    ]);

    definitions = mergeEmailDefinitions({
      stored: storedDefinitions,
      event,
      organizationId: scope.organizationId,
      eventId,
    });

    settings = {
      fromName: identity.fromName,
      fromAddress: identity.fromAddress,
      replyTo: identity.replyTo,
      source: identity.source,
      hasStoredDoc: storedSettings !== null,
    };

    const samplePreviewContext = attachEmailTemplateVariables({
      context: sample.context,
      source: variableSource,
    });

    tokenSections = buildEmailComposerTokenSections({
      source: variableSource,
      previewContext: samplePreviewContext,
    });

    const confirmationDefinition = definitions.find(
      (definition) => definition.kind === "confirmation-paid",
    );
    if (confirmationDefinition) {
      // M6-T4: a block-designed confirmation-paid definition renders its
      // block-assembled HTML here too — otherwise this card would show the
      // stale plain-text body even though the definition is block-authored.
      const rendered = renderEmailDefinitionPreview({
        subjectTemplate: confirmationDefinition.subject,
        bodyTemplate: confirmationDefinition.body,
        context: samplePreviewContext,
        bodyMode: confirmationDefinition.bodyMode,
        bodyBlocks: confirmationDefinition.bodyBlocks,
        blockContext,
      });
      confirmationPreview = {
        ...rendered,
        qrSvg: sample.context.qrCodeSvg ?? null,
        isRealAttendee: sample.isRealAttendee,
      };
    }

    const messages = logRows.map(serializeEmailMessage);
    initialLog = {
      messages,
      count: logCount,
      nextCursor:
        logRows.length === EMAIL_MESSAGE_LIST_LIMIT
          ? (messages[messages.length - 1]?.createdAtMs ?? null)
          : null,
    };
  } catch {
    // Shell + tabs stay interactive; each region shows a retryable error
    // panel (M1 "shell stays interactive" convention).
    loadError = true;
  }

  const initialEditor = resolveEmailWorkspaceEditorState({
    editor: Array.isArray(editor) ? editor[0] : editor,
    editorMode: Array.isArray(editorMode) ? editorMode[0] : editorMode,
  });

  return (
    <EmailsWorkspace
      eventId={eventId}
      timeZone={timeZone}
      initialTab={resolveEmailWorkspaceTab(Array.isArray(tab) ? tab[0] : tab)}
      definitions={definitions}
      settings={settings}
      tokenSections={tokenSections}
      confirmationPreview={confirmationPreview}
      initialLog={initialLog}
      loadError={loadError}
      initialEditorKind={initialEditor.kind}
      initialEditorCreate={initialEditor.isCreate}
      initialEditorMode={initialEditor.forceInitialMode}
    />
  );
}
