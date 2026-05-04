"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlignLeft,
  Blocks,
  Eye,
  EyeOff,
  GripVertical,
  LockKeyhole,
  Mail,
  Plus,
  Save,
  Settings2,
  Trash2,
  Type,
} from "lucide-react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import {
  formBuilderSchema,
  type FormBuilderInput,
  type FormBuilderValues,
  type FormFieldTypeValues,
  type FormFieldValues,
} from "@/features/form/schema";
import {
  buildInitialFormDraft,
  buildFormDraftFromTemplate,
  createCustomFormField,
  isTemplateManagedField,
  reorderFormFields,
  type SerializedForm,
  type SerializedFormTemplate,
} from "@/features/form/utils";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const FORM_ID = "event-form-builder";

const fieldPalette = [
  {
    type: "text" as const,
    title: "Short text",
    description: "Capture simple one-line answers.",
    icon: Type,
  },
  {
    type: "email" as const,
    title: "Email",
    description: "Collect contactable email addresses.",
    icon: Mail,
  },
  {
    type: "textarea" as const,
    title: "Long answer",
    description: "Great for notes, preferences, or context.",
    icon: AlignLeft,
  },
];

function buildBuilderDefaults(
  eventName: string,
  initialForm: SerializedForm | null,
  initialTemplate: SerializedFormTemplate | null,
): FormBuilderValues {
  if (!initialForm) {
    return initialTemplate
      ? buildFormDraftFromTemplate(eventName, initialTemplate)
      : buildInitialFormDraft(eventName);
  }

  return {
    title: initialForm.title,
    status: initialForm.status,
    fields: reorderFormFields(initialForm.fields as FormFieldValues[]),
  };
}

function getFieldTypeLabel(type: FormFieldTypeValues) {
  switch (type) {
    case "text":
      return "Short text";
    case "email":
      return "Email";
    case "textarea":
      return "Long answer";
    default:
      return type;
  }
}

function PreviewField({ field }: { field: FormFieldValues }) {
  return (
    <div className="space-y-2 rounded-[1.5rem] border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-slate-950">{field.label}</p>
        {field.required ? (
          <Badge className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-900 shadow-none">
            Required
          </Badge>
        ) : null}
      </div>
      {field.helpText ? (
        <p className="text-sm leading-6 text-slate-500">{field.helpText}</p>
      ) : null}

      {field.type === "textarea" ? (
        <Textarea
          disabled
          rows={field.rows ?? 4}
          placeholder={field.placeholder || "Type your answer"}
          className="rounded-[1.25rem] border-slate-200 bg-slate-50 text-slate-700 disabled:opacity-100"
        />
      ) : (
        <Input
          disabled
          type={field.type === "email" ? "email" : "text"}
          placeholder={field.placeholder || "Type your answer"}
          className="h-12 rounded-2xl border-slate-200 bg-slate-50 text-slate-700 disabled:opacity-100"
        />
      )}
    </div>
  );
}

interface SortableFieldRowProps {
  field: FormFieldValues;
  isSelected: boolean;
  isTemplateManaged: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

function SortableFieldRow({
  field,
  isSelected,
  isTemplateManaged,
  onSelect,
  onRemove,
}: SortableFieldRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "rounded-[1.5rem] border bg-white p-4 shadow-sm transition",
        isSelected
          ? "border-orange-300 ring-2 ring-orange-100"
          : "border-slate-200 hover:border-slate-300",
        isDragging && "shadow-lg",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className="flex flex-1 items-start gap-3 text-left"
          onClick={onSelect}
        >
          <button
            type="button"
            className="mt-0.5 rounded-full border border-slate-200 bg-slate-50 p-2 text-slate-500"
            {...attributes}
            {...listeners}
            onClick={(event) => event.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
            <span className="sr-only">Reorder field</span>
          </button>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-950">
                {field.label}
              </p>
              <Badge
                variant="secondary"
                className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 shadow-none"
              >
                {getFieldTypeLabel(field.type)}
              </Badge>
              {field.isMandatory ? (
                <Badge className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-900 shadow-none">
                  Locked
                </Badge>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
              <span>Key: {field.key}</span>
              {field.required ? <span>Required</span> : <span>Optional</span>}
            </div>

            {field.helpText ? (
              <p className="text-sm leading-6 text-slate-600">{field.helpText}</p>
            ) : (
              <p className="text-sm leading-6 text-slate-400">
                No helper copy yet.
              </p>
            )}
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full"
          onClick={onRemove}
          disabled={field.isMandatory || isTemplateManaged}
          title={
            field.isMandatory
              ? "Mandatory fields cannot be deleted"
              : isTemplateManaged
                ? "Template-managed fields stay controlled by the template while this form remains linked"
              : "Remove field"
          }
        >
          {field.isMandatory || isTemplateManaged ? (
            <LockKeyhole className="h-4 w-4" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          <span className="sr-only">Remove field</span>
        </Button>
      </div>
    </div>
  );
}

interface FormBuilderWorkspaceProps {
  eventId: string;
  eventName: string;
  organizationId: string;
  organizationName: string;
  initialForm: SerializedForm | null;
  initialTemplate?: SerializedFormTemplate | null;
}

export function FormBuilderWorkspace({
  eventId,
  eventName,
  organizationId,
  organizationName,
  initialForm,
  initialTemplate = null,
}: FormBuilderWorkspaceProps) {
  const router = useRouter();
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(
    initialForm?.fields[0]?.id ?? null,
  );
  const [currentFormId, setCurrentFormId] = useState<string | null>(
    initialForm?.id ?? null,
  );
  const [currentTemplateLink, setCurrentTemplateLink] = useState(
    initialForm?.templateLink
      ? {
          templateId: initialForm.templateLink.templateId,
          templateVersion: initialForm.templateLink.templateVersion,
          detached: initialForm.templateLink.detached,
        }
      : initialTemplate
        ? {
            templateId: initialTemplate.id,
            templateVersion: initialTemplate.version,
            detached: false,
          }
        : null,
  );

  const form = useForm<FormBuilderInput, undefined, FormBuilderValues>({
    resolver: zodResolver(formBuilderSchema),
    defaultValues: buildBuilderDefaults(eventName, initialForm, initialTemplate),
  });

  const fieldArray = useFieldArray({
    control: form.control,
    name: "fields",
    keyName: "fieldKey",
  });
  const watchedFieldsValue = useWatch({
    control: form.control,
    name: "fields",
    defaultValue: form.getValues("fields"),
  });
  const watchedFields = useMemo(
    () => (watchedFieldsValue ?? []) as FormFieldValues[],
    [watchedFieldsValue],
  );

  const selectedFieldIndex = watchedFields.findIndex(
    (field) => field.id === selectedFieldId,
  );
  const selectedField =
    selectedFieldIndex >= 0 ? watchedFields[selectedFieldIndex] : null;

  useEffect(() => {
    if (!watchedFields.length) {
      setSelectedFieldId(null);
      return;
    }

    if (!selectedFieldId || !watchedFields.some((field) => field.id === selectedFieldId)) {
      setSelectedFieldId(watchedFields[0].id);
    }
  }, [selectedFieldId, watchedFields]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const orderedFields = useMemo(
    () => reorderFormFields(watchedFields),
    [watchedFields],
  );
  const linkedTemplateSummary =
    currentTemplateLink && initialTemplate && initialTemplate.id === currentTemplateLink.templateId
      ? initialTemplate
      : null;
  const templateUpdateAvailable =
    Boolean(linkedTemplateSummary) &&
    Boolean(currentTemplateLink) &&
    !currentTemplateLink?.detached &&
    (linkedTemplateSummary?.version ?? 0) > (currentTemplateLink?.templateVersion ?? 0);

  function handleAddField(type: FormFieldTypeValues) {
    const nextField = createCustomFormField(type, watchedFields.length);
    fieldArray.append(nextField);
    setSelectedFieldId(nextField.id);
    setIsPreviewMode(false);
  }

  function handleRemoveField(index: number) {
    const field = watchedFields[index];

    if (!field || field.isMandatory || isTemplateManagedField(field, currentTemplateLink)) {
      return;
    }

    fieldArray.remove(index);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = watchedFields.findIndex((field) => field.id === active.id);
    const newIndex = watchedFields.findIndex((field) => field.id === over.id);

    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const reordered = arrayMove(watchedFields, oldIndex, newIndex).map(
      (field, index) => ({
        ...field,
        order: index,
      }),
    );

    form.setValue("fields", reordered, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  }

  async function onSubmit(values: FormBuilderValues) {
    try {
      const response = await fetch(`/api/dashboard/events/${eventId}/form`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: values.title.trim(),
          status: values.status,
          fields: reorderFormFields(values.fields),
          templateLink: currentTemplateLink,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        formId?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save the form");
      }

      if (payload.formId) {
        setCurrentFormId(payload.formId);
      }

      toast.success("Registration form saved", {
        description:
          "The organizer-facing draft is now stored in Firestore for this event.",
      });

      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("Unable to save the form", {
        description: "Please try again in a moment.",
      });
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  async function handleDetachTemplate() {
    if (!currentFormId || !currentTemplateLink || currentTemplateLink.detached) {
      return;
    }

    try {
      const response = await fetch(`/api/dashboard/events/${eventId}/form/detach`, {
        method: "POST",
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to detach the form");
      }

      setCurrentTemplateLink((currentLink) =>
        currentLink ? { ...currentLink, detached: true } : currentLink,
      );
      toast.success("Template detached", {
        description:
          "This event form can now be edited independently without future template updates.",
      });
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("Unable to detach template", {
        description: "Please try again in a moment.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Event-owned form"
        title={`Build the registration flow for ${eventName}.`}
        description="Start with the mandatory attendee details, then add or reorder custom fields as needed. This first version keeps the builder focused, event-scoped, and easy to evolve."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/dashboard/events/${eventId}`}>Back to event</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsPreviewMode((current) => !current)}
            >
              {isPreviewMode ? (
                <>
                  <EyeOff className="mr-2 h-4 w-4" />
                  Exit preview
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-4 w-4" />
                  Preview
                </>
              )}
            </Button>
            <Button type="submit" form={FORM_ID} disabled={isSubmitting}>
              {isSubmitting ? (
                "Saving..."
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save draft
                </>
              )}
            </Button>
            {linkedTemplateSummary ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleDetachTemplate}
                disabled={!currentFormId || Boolean(currentTemplateLink?.detached)}
              >
                {currentTemplateLink?.detached ? "Detached" : "Detach template"}
              </Button>
            ) : null}
          </>
        }
      />

      <Form {...form}>
        <form
          id={FORM_ID}
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid gap-6 2xl:grid-cols-[280px_minmax(0,1fr)_340px]"
        >
          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-2xl text-slate-950">
                    Field palette
                  </CardTitle>
                  <CardDescription>
                    Add the next custom question without leaving the builder.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0">
              {fieldPalette.map((field) => {
                const Icon = field.icon;

                return (
                  <button
                    key={field.type}
                    type="button"
                    onClick={() => handleAddField(field.type)}
                    className="w-full rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4 text-left transition hover:border-orange-300 hover:bg-orange-50/70"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-orange-900 shadow-sm">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-950">
                          {field.title}
                        </p>
                        <p className="text-sm leading-6 text-slate-600">
                          {field.description}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}

              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4 text-sm leading-7 text-slate-600">
                <p className="font-semibold text-slate-950">Workspace scope</p>
                <p className="mt-2">{organizationName}</p>
                <p className="mt-1 break-all text-xs text-slate-500">
                  Event ID: {eventId}
                </p>
                <p className="mt-1 break-all text-xs text-slate-500">
                  Form ID: {currentFormId ?? "Draft not saved yet"}
                </p>
                {linkedTemplateSummary ? (
                  <>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Linked template
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {linkedTemplateSummary.title}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Version {currentTemplateLink?.templateVersion ?? linkedTemplateSummary.version}
                      {currentTemplateLink?.detached ? " • Detached" : " • Linked"}
                    </p>
                    {templateUpdateAvailable ? (
                      <p className="mt-1 text-xs font-medium text-orange-900">
                        A newer template version is available. Open the template to apply updates.
                      </p>
                    ) : null}
                    <Link
                      href={`/dashboard/forms/templates/${linkedTemplateSummary.id}`}
                      className="mt-2 inline-flex text-xs font-medium text-orange-900 underline-offset-4 hover:underline"
                    >
                      Manage template
                    </Link>
                  </>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                  <Blocks className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-2xl text-slate-950">
                    {isPreviewMode ? "Participant preview" : "Builder canvas"}
                  </CardTitle>
                  <CardDescription>
                    {isPreviewMode
                      ? "This mirrors the attendee-facing registration flow using the same field configuration."
                      : "Reorder fields with drag and drop, then select one to edit its settings."}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 px-6 pb-6 pt-0">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_220px]">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Form title</FormLabel>
                      <FormControl>
                        <Input
                          className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                          placeholder="Event registration"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <FormControl>
                        <select
                          className="flex h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm shadow-sm outline-none transition focus:border-orange-300"
                          value={field.value}
                          onChange={field.onChange}
                        >
                          <option value="draft">Draft</option>
                          <option value="published">Published</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {isPreviewMode ? (
                <div className="space-y-4 rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-900">
                      Registration preview
                    </p>
                    <h2 className="text-2xl font-semibold text-slate-950">
                      {form.watch("title")}
                    </h2>
                    <p className="text-sm leading-7 text-slate-600">
                      This read-only view helps organizers sense-check the
                      participant-facing flow before the public form route is built.
                    </p>
                  </div>

                  <div className="space-y-4">
                    {orderedFields.map((field) => (
                      <PreviewField key={field.id} field={field} />
                    ))}
                  </div>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={watchedFields.map((field) => field.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-4">
                      {fieldArray.fields.map((field, index) => (
                        <SortableFieldRow
                          key={field.fieldKey}
                          field={watchedFields[index] ?? field}
                          isSelected={selectedFieldId === field.id}
                          isTemplateManaged={isTemplateManagedField(
                            watchedFields[index] ?? field,
                            currentTemplateLink,
                          )}
                          onSelect={() => setSelectedFieldId(field.id)}
                          onRemove={() => handleRemoveField(index)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                  <Settings2 className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-2xl text-slate-950">
                    Field settings
                  </CardTitle>
                  <CardDescription>
                    Tune labels, helper text, and validation for the selected
                    field.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 px-6 pb-6 pt-0">
              {selectedField && selectedFieldIndex >= 0 ? (
                <>
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-950">
                        {selectedField.label}
                      </p>
                      <Badge
                        variant="secondary"
                        className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 shadow-none"
                      >
                        {getFieldTypeLabel(selectedField.type)}
                      </Badge>
                      {selectedField.isMandatory ? (
                        <Badge className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-900 shadow-none">
                          Locked
                        </Badge>
                      ) : isTemplateManagedField(selectedField, currentTemplateLink) ? (
                        <Badge className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 shadow-none">
                          Template
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                      Key
                    </p>
                    <p className="mt-1 break-all text-sm text-slate-700">
                      {selectedField.key}
                    </p>
                  </div>

                  <FormField
                    control={form.control}
                    name={`fields.${selectedFieldIndex}.label`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Label</FormLabel>
                        <FormControl>
                          <Input
                            className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                            disabled={isTemplateManagedField(selectedField, currentTemplateLink)}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`fields.${selectedFieldIndex}.placeholder`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Placeholder</FormLabel>
                        <FormControl>
                          <Input
                            className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                            disabled={isTemplateManagedField(selectedField, currentTemplateLink)}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`fields.${selectedFieldIndex}.helpText`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Helper text</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={3}
                            className="min-h-24 rounded-[1.5rem] border-slate-200 bg-slate-50"
                            disabled={isTemplateManagedField(selectedField, currentTemplateLink)}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Optional guidance shown below the field label.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`fields.${selectedFieldIndex}.required`}
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50/90 p-4">
                        <div className="space-y-1">
                          <FormLabel>Required field</FormLabel>
                          <FormDescription>
                            Mandatory fields always stay required. Custom fields can
                            be optional.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={
                              selectedField.isMandatory ||
                              isTemplateManagedField(selectedField, currentTemplateLink)
                            }
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {selectedField.type === "textarea" ? (
                    <FormField
                      control={form.control}
                      name={`fields.${selectedFieldIndex}.rows`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Textarea rows</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={2}
                              max={12}
                              className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              value={field.value === undefined ? "" : String(field.value)}
                              disabled={isTemplateManagedField(selectedField, currentTemplateLink)}
                              onChange={(event) => field.onChange(event.target.value)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null}
                </>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-600">
                  Select a field from the builder canvas to edit its settings.
                </div>
              )}
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  );
}
