"use client";

import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, X } from "lucide-react";
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
  EmailComposerTokenSection,
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

const PREVIEW_DEBOUNCE_MS = 400;

interface EmailEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  timeZone: string;
  definitionsByKind: Map<string, SerializedEmailDefinition>;
  definition: SerializedEmailDefinition | null;
  onSaved: () => void;
  forceInitialMode?: EmailBodyMode;
  tokenSections?: EmailComposerTokenSection[];
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
  tokenSections = [],
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
  const { isDirty } = form.formState;

  const isBlocksMode = bodyMode === "blocks";
  const isEmptyBlockCanvas = isBlocksMode && bodyBlocks.length === 0;
  const bodyBlocksKey = JSON.stringify(bodyBlocks);

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

  if (!open) return null;

  const title = isCreate ? "New email" : definition!.name;
  const groupLabel = EMAIL_GROUP_LABELS[form.watch("group")];
  const subtitle = isCreate
    ? "Create a custom message with room to write, preview, and test."
    : isSystem
      ? "Edit the live lifecycle email in a full workspace."
      : "Edit this custom email in a full workspace.";

  return (
    <>
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <Tabs
          defaultValue="compose"
          className="flex min-h-[calc(100vh-12rem)] flex-col"
        >
          <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
                  <Badge variant="secondary">
                    {isSystem ? "System" : "Custom"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{groupLabel}</span>
                  <span className="mx-2 text-slate-300">•</span>
                  {subtitle}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <TabsList>
                  <TabsTrigger value="compose">Compose</TabsTrigger>
                  <TabsTrigger value="history" disabled={isCreate}>
                    History
                  </TabsTrigger>
                </TabsList>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={attemptClose}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close editor</span>
                </Button>
              </div>
            </div>
          </div>

          <TabsContent
            value="compose"
            className="mt-0 flex min-h-0 flex-1 flex-col"
          >
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7">
                  <div className="space-y-6">
                    <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
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
                                  Used for display only - audience targeting
                                  arrives with M6-T3.
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
                      </div>

                      <div className="mt-4 space-y-3">
                        {isSystem ? (
                          <p className="text-xs text-muted-foreground">
                            This is a default lifecycle email - its name, group,
                            trigger type and audience stay fixed.
                          </p>
                        ) : null}

                        <FormField
                          control={form.control}
                          name="enabled"
                          render={({ field }) => (
                            <FormItem className="rounded-xl border border-border bg-white p-3">
                              <div className="flex flex-row items-center justify-between gap-2">
                                <div>
                                  <FormLabel className="font-medium">
                                    Active
                                  </FormLabel>
                                  <FormDescription>
                                    Registrants receive this once automation is
                                    live (M6-T3).
                                  </FormDescription>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                    aria-label="Active"
                                  />
                                </FormControl>
                              </div>
                            </FormItem>
                          )}
                        />

                        {!enabled ? (
                          <p className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm">
                            This email is off - it won&apos;t send when automations
                            arrive.
                          </p>
                        ) : null}
                      </div>
                    </section>

                    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <h2 className="text-lg font-semibold">Content</h2>
                          <p className="text-sm text-muted-foreground">
                            Keep the message simple, then preview what attendees
                            will actually receive.
                          </p>
                        </div>
                        <EmailEditorModeToggle form={form} />
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
                                className="max-w-3xl"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {isBlocksMode ? (
                        <EmailBlockDesigner
                          form={form}
                          preview={preview}
                          previewLoading={previewLoading}
                          previewError={previewError}
                          tokenSections={tokenSections}
                        />
                      ) : (
                        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(24rem,0.7fr)] xl:items-start">
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
                                    tokenSections={tokenSections}
                                  />
                                </div>
                                <FormControl>
                                  <Textarea
                                    rows={20}
                                    className="min-h-[34rem] font-mono text-sm"
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

                          <div className="xl:sticky xl:top-6">
                            <p className="mb-2 text-sm font-semibold text-foreground">
                              Live preview
                            </p>
                            <EmailPreviewFrame
                              subject={preview?.subject ?? subject}
                              bodyHtml={preview?.bodyHtml ?? ""}
                              missingTags={preview?.missingTags ?? []}
                              unknownTags={preview?.unknownTags ?? []}
                              unknownVariables={preview?.unknownVariables ?? []}
                              loading={previewLoading}
                              error={previewError}
                            />
                          </div>
                        </div>
                      )}
                    </section>
                  </div>
                </div>

                <div className="border-t border-slate-200 bg-white px-5 py-4 sm:px-7">
                  <EmailEditorTestSendRow state={testSend} />

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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
                          <Loader2 aria-hidden="true" className="animate-spin" />
                        ) : null}
                        Save
                      </Button>
                    </div>
                  </div>
                </div>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="history" className="mt-0 flex-1 px-5 py-5 sm:px-7">
            {definition ? (
              <EmailHistoryTab
                eventId={eventId}
                kind={definition.kind}
                definitionsByKind={definitionsByKind}
              />
            ) : null}
          </TabsContent>
        </Tabs>
      </section>

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
