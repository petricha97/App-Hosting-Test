"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Data } from "@measured/puck";
import { Puck } from "@measured/puck";
import type { UseFormReturn } from "react-hook-form";

import { Skeleton } from "@/components/ui/skeleton";
import { EmailBlockFieldNote } from "@/features/emails/components/email-block-field-note";
import { EmailCanvasDisclaimer } from "@/features/emails/components/email-canvas-disclaimer";
import { EmailPreviewFrame } from "@/features/emails/components/email-preview-frame";
import {
  createEmailPuckConfig,
  type MergeTagFocusController,
  type MergeTagFocusTarget,
} from "@/features/emails/components/email-puck-config";
import { MergeTagMenu } from "@/features/emails/components/merge-tag-menu";
import type { EmailEditorFormValues } from "@/features/emails/schemas";
import type {
  EmailComposerTokenSection,
  EmailPuckBlock,
  EmailSafeBlockType,
  RenderedEmailPreview,
} from "@/features/emails/types";
import { ensurePuckDataIds } from "@/features/event-pages/puck";

interface EmailBlockDesignerProps {
  form: UseFormReturn<EmailEditorFormValues>;
  preview: RenderedEmailPreview | null;
  previewLoading: boolean;
  previewError: string | null;
  tokenSections?: EmailComposerTokenSection[];
}

function bodyBlocksToPuckData(blocks: EmailPuckBlock[]): Data {
  return ensurePuckDataIds({
    content: blocks.map((block) => ({
      id: block.id,
      type: block.type,
      props: block.props,
    })),
    root: {},
    zones: {},
  });
}

function puckDataToBodyBlocks(data: Data): EmailPuckBlock[] {
  return (data.content ?? []).map((item, index) => {
    const props = (item.props ?? {}) as Record<string, unknown> & {
      id?: string;
    };
    const { id, ...restProps } = props;
    const resolvedId =
      typeof id === "string" && id.trim().length > 0
        ? id
        : `${String(item.type ?? "block").toLowerCase()}-${index + 1}`;
    return {
      id: resolvedId,
      type: item.type as EmailSafeBlockType,
      props: restProps,
    };
  });
}

export function EmailBlockDesigner({
  form,
  preview,
  previewLoading,
  previewError,
  tokenSections = [],
}: EmailBlockDesignerProps) {
  const elementRef = useRef<MergeTagFocusTarget | null>(null);
  const onChangeRef = useRef<((next: string) => void) | null>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [shellReady, setShellReady] = useState(false);

  useEffect(() => {
    setShellReady(true);
  }, []);

  const onFieldFocused = useCallback(
    () => setFocusVersion((version) => version + 1),
    [],
  );
  const hasFocusedField = focusVersion > 0;

  const focusController: MergeTagFocusController = useMemo(
    () => ({ elementRef, onChangeRef, onFieldFocused }),
    [onFieldFocused],
  );

  const puckConfig = useMemo(
    () => createEmailPuckConfig({ focusController }),
    [focusController],
  );

  const bodyBlocks = form.watch("bodyBlocks") as EmailPuckBlock[];
  const isEmpty = bodyBlocks.length === 0;

  const handlePuckChange = (data: Data) => {
    const normalized = ensurePuckDataIds(data);
    const nextBlocks = puckDataToBodyBlocks(normalized);
    const current = form.getValues("bodyBlocks");
    if (JSON.stringify(nextBlocks) === JSON.stringify(current)) return;
    form.setValue("bodyBlocks", nextBlocks, { shouldDirty: true });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground sm:hidden">
        The visual editor works best on a larger screen, but you can still keep
        editing here when needed.
      </p>

      <EmailCanvasDisclaimer />

      {isEmpty ? (
        <EmailBlockFieldNote tone="warning" variant="banner">
          This email has no content blocks yet. Drag a block from the panel to
          start building the message.
        </EmailBlockFieldNote>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Click into any text field below, then insert a field or merge tag.
        </p>
        <MergeTagMenu
          textareaRef={elementRef}
          value={elementRef.current?.value ?? ""}
          onChange={(next) => onChangeRef.current?.(next)}
          disabled={!hasFocusedField}
          tokenSections={tokenSections}
        />
      </div>

      <div className="min-h-[42rem] overflow-hidden rounded-2xl border border-border bg-white">
        {shellReady ? (
          <Puck
            config={puckConfig}
            data={bodyBlocksToPuckData(bodyBlocks)}
            renderHeaderActions={() => <div />}
            onChange={handlePuckChange}
          />
        ) : (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">
          Live preview
        </p>
        <EmailPreviewFrame
          subject={preview?.subject ?? ""}
          bodyHtml={preview?.bodyHtml ?? ""}
          missingTags={preview?.missingTags ?? []}
          unknownTags={preview?.unknownTags ?? []}
          unknownVariables={preview?.unknownVariables ?? []}
          loading={previewLoading}
          error={previewError}
        />
      </div>
    </div>
  );
}
