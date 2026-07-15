"use client";

// Compose / edit dialog (design §3) — the ONE surface for both system
// (isSystem:true) and custom definitions, plus "+ Create email" (blank
// custom). Wide (`sm:max-w-4xl`, deliberate divergence from the app's usual
// `sm:max-w-lg` — the compose/preview grid needs the room, design §3 note).
import { useEffect, useId, useRef, useState } from "react";
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
import { EmailEditorLockedRow } from "@/features/emails/components/email-editor-locked-row";
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
  // null = "+ Create email" (blank custom definition).
  definition: SerializedEmailDefinition | null;
  onSaved: () => void;
}

function buildDefaultValues(
  definition: SerializedEmailDefinition | null,
  timeZone: string,
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
}: EmailEditorDialogProps) {
  const isCreate = definition === null;
  const isSystem = definition?.isSystem ?? false;
  const groupLabelId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const form = useForm<EmailEditorFormValues>({
    resolver: zodResolver(emailEditorFormSchema),
    defaultValues: buildDefaultValues(definition, timeZone),
  });
  const testSend = useEmailEditorTestSend(eventId, definition, open);

  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<RenderedEmailPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      form.reset(buildDefaultValues(definition, timeZone));
      setPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, definition, timeZone]);

  const subject = form.watch("subject");
  const body = form.watch("body");
  const triggerType = form.watch("triggerType");
  const enabled = form.watch("enabled");
  // Must be read synchronously during render (not only inside a callback)
  // so RHF's formState Proxy subscribes this field for reactive tracking —
  // otherwise attemptClose() below sees a stale, always-false value.
  const { isDirty } = form.formState;

  // Debounced live preview (design §3) — re-renders through the SAME
  // server-side pipeline as the confirmation card / test send.
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
          body: JSON.stringify({ subject, body }),
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
  }, [open, eventId, subject, body]);

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
    };
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
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
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
                  <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="space-y-4">
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

                      <EmailEditorTriggerFields
                        isSystem={isSystem}
                        definitionTrigger={definition?.trigger ?? null}
                        timeZone={timeZone}
                        triggerType={triggerType}
                        form={form}
                      />

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
                                Used for display only — audience targeting
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

                      <FormField
                        control={form.control}
                        name="subject"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Subject</FormLabel>
                            <FormControl>
                              <Input maxLength={255} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

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
                    </div>

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

                  <EmailEditorTestSendRow state={testSend} />

                  <DialogFooter className="flex-wrap gap-2 sm:justify-between">
                    <div>
                      <EmailEditorTestSendButton
                        state={testSend}
                        enabled={enabled}
                        isCreate={isCreate}
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
