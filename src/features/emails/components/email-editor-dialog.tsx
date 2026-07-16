"use client";

// Compose / edit dialog (M6-T2 design §3, extended by M6-T4 design §3) — the
// ONE surface for both system (isSystem:true) and custom definitions, plus
// "+ Create email" (blank custom). Width is now MODE-CONDITIONAL
// (`sm:max-w-4xl` Plain-text / `sm:max-w-6xl` Block-designer, M6-T4 design
// §3.1 — a further, explicitly-flagged divergence on top of T2's own
// already-flagged `sm:max-w-4xl` divergence from the app's usual
// `sm:max-w-lg`).
import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { applyApiFormError } from "@/features/registration/components/form-errors";
import { EmailBlockDesigner } from "@/features/emails/components/email-block-designer";
import { EmailEditorLockedRow } from "@/features/emails/components/email-editor-locked-row";
import { EmailEditorModeToggle } from "@/features/emails/components/email-editor-mode-toggle";
import {
  EmailEditorTestSendButton,
  EmailEditorTestSendRow,
  useEmailEditorTestSend,
} from "@/features/emails/components/email-editor-test-send";
import { EmailEditorTriggerFields } from "@/features/emails/components/email-editor-trigger-fields";
import { EmailHistoryTab } from "@/features/emails/components/email-history-tab";
import { EmailPreviewFrame } from "@/features/emails/components/email-preview-frame";
import { MergeTagMenu } from "@/features/emails/components/merge-tag-menu";
import {
  emailEditorFormSchema,
  type EmailEditorFormValues,
} from "@/features/emails/schemas";
import type {
  EmailBodyMode,
  EmailPuckBlock,
  RenderedEmailPreview,
  SerializedEmailDefinition,
} from "@/features/emails/types";
import {
  EMAIL_AUDIENCE_LABELS,
  EMAIL_AUDIENCE_OPTIONS,
  EMAIL_GROUP_LABELS,
  EMAIL_GROUP_OPTIONS,
  atMsToDateTimeLocalInput,
  dateTimeLocalInputToAtMs,
} from "@/features/emails/utils";
import { cn } from "@/lib/utils";

const PREVIEW_DEBOUNCE_MS = 400;

interface EmailEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  timeZone: string;
  definitionsByKind: Map<string, SerializedEmailDefinition>;
  // null = "+ Create email" (blank custom definition).
  definition: SerializedEmailDefinition | null;
  onSaved: () => void;
  // M6-T4 (design §1) — set ONLY by the definition-picker menu's entry
  // point: forces the mode toggle's INITIAL state to "Block designer" for
  // this open. Ordinary row-click editing (email-group-table.tsx) omits
  // this and keeps defaulting to the definition's persisted bodyMode.
  // Forcing the default value (not calling setValue after reset) means this
  // never marks the freshly-opened form dirty on its own.
  forceInitialMode?: EmailBodyMode;
}

function buildDefaultValues(
  definition: SerializedEmailDefinition | null,
  timeZone: string,
  forceInitialMode?: EmailBodyMode,
): EmailEditorFormValues {
  if (!definition) {
    return {
      name: "",
      group: "pre-event",
      triggerType: "manual",
      scheduledAt: "",
      audience: "accepted-all",
      enabled: true,
      subject: "",
      body: "",
      bodyMode: forceInitialMode ?? "text",
      bodyBlocks: [],
    };
  }
  return {
    name: definition.name,
    group: definition.group,
    triggerType:
      definition.trigger.type === "scheduled" ? "scheduled" : "manual",
    scheduledAt:
      definition.trigger.type === "scheduled"
        ? atMsToDateTimeLocalInput(definition.trigger.atMs, timeZone)
        : "",
    audience: definition.audience,
    enabled: definition.enabled,
    subject: definition.subject,
    body: definition.body,
    bodyMode: forceInitialMode ?? definition.bodyMode ?? "text",
    bodyBlocks: definition.bodyBlocks ?? [],
  };
}

function buildTriggerPayload(values: EmailEditorFormValues, timeZone: string) {
  if (values.triggerType === "manual") return { type: "manual" as const };
  return {
    type: "scheduled" as const,
    atMs: dateTimeLocalInputToAtMs(values.scheduledAt, timeZone),
  };
}

export function EmailEditorDialog({
  open,
  onOpenChange,
  eventId,
  timeZone,
  definitionsByKind,
  definition,
  onSaved,
  forceInitialMode,
}: EmailEditorDialogProps) {
  const isCreate = definition === null;
  const isSystem = definition?.isSystem ?? false;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const form = useForm<EmailEditorFormValues>({
    resolver: zodResolver(emailEditorFormSchema),
    defaultValues: buildDefaultValues(definition, timeZone, forceInitialMode),
  });
  const testSend = useEmailEditorTestSend(eventId, definition, open);

  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<RenderedEmailPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      form.reset(buildDefaultValues(definition, timeZone, forceInitialMode));
      setPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, definition, timeZone, forceInitialMode]);

  const subject = form.watch("subject");
  const body = form.watch("body");
  const bodyMode = form.watch("bodyMode");
  const bodyBlocks = form.watch("bodyBlocks") as EmailPuckBlock[];
  const triggerType = form.watch("triggerType");
  const enabled = form.watch("enabled");
  // Must be read synchronously during render (not only inside a callback)
  // so RHF's formState Proxy subscribes this field for reactive tracking —
  // otherwise attemptClose() below sees a stale, always-false value.
  const { isDirty } = form.formState;

  const isBlocksMode = bodyMode === "blocks";
  const isEmptyBlockCanvas = isBlocksMode && bodyBlocks.length === 0;
  // Stable dependency for the preview effect below — bodyBlocks' array
  // reference can change without its content changing; comparing the
  // serialized form avoids re-fetching the preview on no-op re-renders.
  const bodyBlocksKey = JSON.stringify(bodyBlocks);

  // Debounced live preview (design §3) — re-renders through the SAME
  // server-side pipeline as the confirmation card / test send. M6-T4:
  // widened to also send bodyMode/bodyBlocks — but `bodyBlocks` is included
  // ONLY while actually in Block-designer mode. A definition's stored
  // bodyBlocks can reference a since-removed block type that the RENDER
  // pipeline gracefully skips (spec §1 AC-8) but the WRITE-time schema
  // (reused here for request validation) rejects outright; sending it
  // unconditionally would break the preview for a Plain-text-mode edit on
  // such a definition even though bodyBlocks is completely irrelevant to a
  // "text" mode render.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/emails/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject,
            body,
            bodyMode,
            bodyBlocks: bodyMode === "blocks" ? bodyBlocks : undefined,
          }),
        },
      )
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data: RenderedEmailPreview) => {
          if (cancelled) return;
          setPreview(data);
          setPreviewError(null);
        })
        .catch(() => {
          if (!cancelled) setPreviewError("Couldn't update the preview.");
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId, subject, body, bodyMode, bodyBlocksKey]);

  const attemptClose = () => {
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onOpenChange(false);
  };

  const onSubmit = async (values: EmailEditorFormValues) => {
    const kind = definition?.kind;
    const trigger = buildTriggerPayload(values, timeZone);

    const patchBody: Record<string, unknown> = {
      enabled: values.enabled,
      subject: values.subject,
      body: values.body,
      // M6-T4 (spec §2 AC-1) — join the same editable bucket as
      // subject/body for BOTH system and custom definitions. `bodyMode` is
      // a plain enum with no cross-field validation risk, so — like
      // subject/body above — it's always sent. `bodyBlocks` is sent ONLY
      // when the canvas was actually touched this session
      // (form.formState.dirtyFields): a stored bodyBlocks array may
      // reference a since-removed block type that the RENDER pipeline
      // gracefully skips (spec §1 AC-8) but the WRITE-time schema rejects
      // outright (a discriminated union with no matching member) —
      // re-submitting it unconditionally on every unrelated plain-text
      // edit would make such a definition permanently unsavable, even for
      // a one-word Subject tweak.
      bodyMode: values.bodyMode,
    };
    if (form.formState.dirtyFields.bodyBlocks) {
      patchBody.bodyBlocks = values.bodyBlocks;
    }
    if (!isSystem) {
      patchBody.name = values.name;
      patchBody.group = values.group;
      patchBody.audience = values.audience;
      patchBody.trigger = trigger;
    } else if (definition?.trigger.type === "scheduled") {
      patchBody.trigger = trigger;
    }

    try {
      const response = isCreate
        ? await fetch(
            `/api/dashboard/events/${encodeURIComponent(eventId)}/emails/definitions`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: values.name,
                group: values.group,
                audience: values.audience,
                enabled: values.enabled,
                subject: values.subject,
                body: values.body,
                bodyMode: values.bodyMode,
                bodyBlocks: values.bodyBlocks,
                trigger,
              }),
            },
          )
        : await fetch(
            `/api/dashboard/events/${encodeURIComponent(eventId)}/emails/definitions/${encodeURIComponent(kind!)}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patchBody),
            },
          );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        applyApiFormError(form, data, "Failed to save the email.");
        return;
      }

      toast.success(isCreate ? "Email created" : "Email saved");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Failed to save the email.", {
        description: "Check your connection and try again.",
      });
    }
  };

  const title = isCreate ? "New email" : definition!.name;
  const groupLabel = EMAIL_GROUP_LABELS[form.watch("group")];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            attemptClose();
            return;
          }
          onOpenChange(next);
        }}
      >
        <DialogContent
          className={cn(
            "max-h-[88vh] overflow-y-auto",
            isBlocksMode ? "sm:max-w-6xl" : "sm:max-w-4xl",
          )}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {title}
              <Badge variant="secondary">
                {isSystem ? "System" : "Custom"}
              </Badge>
            </DialogTitle>
            <DialogDescription>{groupLabel}</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="compose">
            <TabsList>
              <TabsTrigger value="compose">Compose</TabsTrigger>
              <TabsTrigger value="history" disabled={isCreate}>
                History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="compose">
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                >
                  {/* M6-T4 design §3.2: metadata fields move into a
                      full-width strip shared by BOTH modes, so the top of
                      the dialog looks identical when switching modes. */}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {!isSystem ? (
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                              <Input maxLength={120} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : (
                      <EmailEditorLockedRow
                        label="Name"
                        value={definition!.name}
                      />
                    )}

                    {!isSystem ? (
                      <FormField
                        control={form.control}
                        name="group"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Group</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {EMAIL_GROUP_OPTIONS.map((group) => (
                                  <SelectItem key={group} value={group}>
                                    {EMAIL_GROUP_LABELS[group]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : (
                      <EmailEditorLockedRow
                        label="Group"
                        value={EMAIL_GROUP_LABELS[definition!.group]}
                      />
                    )}

                    <div className="space-y-4">
                      <EmailEditorTriggerFields
                        isSystem={isSystem}
                        definitionTrigger={definition?.trigger ?? null}
                        timeZone={timeZone}
                        triggerType={triggerType}
                        form={form}
                      />
                    </div>

                    {!isSystem ? (
                      <FormField
                        control={form.control}
                        name="audience"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Audience</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {EMAIL_AUDIENCE_OPTIONS.map((audience) => (
                                  <SelectItem key={audience} value={audience}>
                                    {EMAIL_AUDIENCE_LABELS[audience]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormDescription>
                              Used for display only — audience targeting arrives
                              with M6-T3.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : (
                      <EmailEditorLockedRow
                        label="Audience"
                        value={EMAIL_AUDIENCE_LABELS[definition!.audience]}
                      />
                    )}

                    <div className="space-y-3 sm:col-span-2 lg:col-span-4">
                      {isSystem ? (
                        <p className="text-xs text-muted-foreground">
                          This is a default lifecycle email — its name, group,
                          trigger type and audience are fixed.
                        </p>
                      ) : null}

                      <FormField
                        control={form.control}
                        name="enabled"
                        render={({ field }) => (
                          <FormItem className="rounded-lg border border-border p-3">
                            <div className="flex flex-row items-center justify-between gap-2">
                              <FormLabel className="font-normal">
                                Active
                              </FormLabel>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  aria-label="Active"
                                />
                              </FormControl>
                            </div>
                            <FormDescription>
                              Registrants receive this once automation is live
                              (M6-T3).
                            </FormDescription>
                          </FormItem>
                        )}
                      />

                      {!enabled ? (
                        <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
                          This email is off — it won&apos;t send when
                          automations arrive.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject</FormLabel>
                        <FormControl>
                          <Input
                            maxLength={255}
                            className="max-w-xl"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <EmailEditorModeToggle form={form} />

                  {isBlocksMode ? (
                    <EmailBlockDesigner
                      form={form}
                      preview={preview}
                      previewLoading={previewLoading}
                      previewError={previewError}
                    />
                  ) : (
                    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <FormField
                        control={form.control}
                        name="body"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between gap-2">
                              <FormLabel>Body</FormLabel>
                              <MergeTagMenu
                                textareaRef={textareaRef}
                                value={field.value}
                                onChange={field.onChange}
                              />
                            </div>
                            <FormControl>
                              <Textarea
                                rows={10}
                                className="font-mono text-sm"
                                {...field}
                                ref={(el) => {
                                  field.ref(el);
                                  textareaRef.current = el;
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div>
                        <EmailPreviewFrame
                          subject={preview?.subject ?? subject}
                          bodyHtml={preview?.bodyHtml ?? ""}
                          missingTags={preview?.missingTags ?? []}
                          unknownTags={preview?.unknownTags ?? []}
                          loading={previewLoading}
                          error={previewError}
                        />
                      </div>
                    </div>
                  )}

                  <EmailEditorTestSendRow state={testSend} />

                  <DialogFooter className="flex-wrap gap-2 sm:justify-between">
                    <div>
                      <EmailEditorTestSendButton
                        state={testSend}
                        enabled={enabled}
                        isCreate={isCreate}
                        disabledReason={
                          isEmptyBlockCanvas
                            ? "Add at least one content block before sending a test"
                            : null
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={attemptClose}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={form.formState.isSubmitting}
                      >
                        {form.formState.isSubmitting ? (
                          <Loader2
                            aria-hidden="true"
                            className="animate-spin"
                          />
                        ) : null}
                        Save
                      </Button>
                    </div>
                  </DialogFooter>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="history">
              {definition ? (
                <EmailHistoryTab
                  eventId={eventId}
                  kind={definition.kind}
                  definitionsByKind={definitionsByKind}
                />
              ) : null}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits to this email haven&apos;t been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setDiscardConfirmOpen(false);
                onOpenChange(false);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
