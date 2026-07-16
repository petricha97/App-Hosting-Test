"use client";

// Block-designer content region (design §3.4-3.6) — replaces the plain-text
// textarea when EmailEditorModeToggle is on "Block designer": a
// narrow-viewport notice (<768px, design §6) -> the disclaimer banner
// (§3.3) -> the empty-canvas warning (§5, when applicable) -> the merge-tag
// toolbar (§3.4) -> the fixed-height Puck shell (§3.5) -> the authoritative
// preview, mounted FULL WIDTH BELOW the canvas, not beside it (§3.6).
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
}: EmailBlockDesignerProps) {
  const elementRef = useRef<MergeTagFocusTarget | null>(null);
  const onChangeRef = useRef<((next: string) => void) | null>(null);
  // A COUNTER, not a boolean — every focus event must force a re-render so
  // `elementRef.current?.value` (read below, at render time) reflects the
  // NEWLY focused field, not whatever field had focus during the last
  // render. A boolean that only flips false -> true once would silently
  // bail out of re-rendering on every focus AFTER the first (React skips a
  // set-same-value update), leaving MergeTagMenu's `value` prop stale —
  // insertTag() would then slice the PREVIOUS field's text and write that
  // (plus the tag) into the newly focused field, corrupting it.
  const [focusVersion, setFocusVersion] = useState(0);
  const [shellReady, setShellReady] = useState(false);

  // Loading state (design §5) — the Puck shell shows a Skeleton until the
  // canvas config is constructed. There's no real async dependency for the
  // email canvas (no assets, no live pricing/countdown data), so this is a
  // deliberately short, honest simulation of that state rather than an
  // unused branch.
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
        Block designer works best on a larger screen — you can keep editing
        here, but the canvas may need horizontal scrolling.
      </p>

      <EmailCanvasDisclaimer />

      {isEmpty ? (
        <EmailBlockFieldNote tone="warning" variant="banner">
          This email has no content blocks yet — drag a block from the panel to
          add content.
        </EmailBlockFieldNote>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Click into any text field below, then insert a tag.
        </p>
        <MergeTagMenu
          textareaRef={elementRef}
          value={elementRef.current?.value ?? ""}
          onChange={(next) => onChangeRef.current?.(next)}
          disabled={!hasFocusedField}
        />
      </div>

      <div className="h-[36rem] overflow-hidden rounded-lg border border-border">
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
          Email preview (this is what sends)
        </p>
        <EmailPreviewFrame
          subject={preview?.subject ?? ""}
          bodyHtml={preview?.bodyHtml ?? ""}
          missingTags={preview?.missingTags ?? []}
          unknownTags={preview?.unknownTags ?? []}
          loading={previewLoading}
          error={previewError}
        />
      </div>
    </div>
  );
}
