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
  CalendarDays,
  Eye,
  EyeOff,
  GripVertical,
  Hash,
  Info,
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
  templateBuilderSchema,
  type FormFieldTypeValues,
  type FormFieldValues,
  type TemplateBuilderInput,
  type TemplateBuilderValues,
} from "@/features/form/schema";
import {
  buildInitialTemplateDraft,
  createCustomFormField,
  reorderFormFields,
  type SerializedFormTemplate,
} from "@/features/form/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const FORM_ID = "form-template-builder";

const fieldPalette = [
  {
    type: "text" as const,
    title: "Short text",
    icon: Type,
  },
  {
    type: "email" as const,
    title: "Email",
    icon: Mail,
  },
  {
    type: "number" as const,
    title: "Number",
    icon: Hash,
  },
  {
    type: "date" as const,
    title: "Date",
    icon: CalendarDays,
  },
  {
    type: "textarea" as const,
    title: "Long answer",
    icon: AlignLeft,
  },
];

function getFieldTypeLabel(type: FormFieldTypeValues) {
  switch (type) {
    case "text":
      return "Short text";
    case "email":
      return "Email";
    case "number":
      return "Number";
    case "date":
      return "Date";
    case "textarea":
      return "Long answer";
    default:
      return type;
  }
}

function getFieldInputType(type: FormFieldTypeValues) {
  switch (type) {
    case "email":
      return "email";
    case "number":
      return "number";
    case "date":
      return "date";
    default:
      return "text";
  }
}

function buildTemplateDefaults(
  initialTemplate: SerializedFormTemplate | null,
): TemplateBuilderValues {
  if (!initialTemplate) {
    return buildInitialTemplateDraft();
  }

  return {
    title: initialTemplate.title,
    description: initialTemplate.description,
    status: initialTemplate.status,
    fields: reorderFormFields(initialTemplate.fields as FormFieldValues[]),
  };
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
          type={getFieldInputType(field.type)}
          placeholder={field.placeholder || "Type your answer"}
          className="h-12 rounded-2xl border-slate-200 bg-slate-50 text-slate-700 disabled:opacity-100"
        />
      )}
    </div>
  );
}

function SortableFieldRow({
  field,
  isSelected,
  onSelect,
  onRemove,
}: {
  field: FormFieldValues;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
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
        <div className="flex flex-1 items-start gap-3 text-left" onClick={onSelect}>
          <button
            type="button"
            className="mt-0.5 rounded-full border border-slate-200 bg-slate-50 p-2 text-slate-500"
            {...attributes}
            {...listeners}
            onClick={(event) => event.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-950">{field.label}</p>
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
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full"
          onClick={onRemove}
          disabled={field.isMandatory}
        >
          {field.isMandatory ? (
            <LockKeyhole className="h-4 w-4" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

interface FormTemplateBuilderWorkspaceProps {
  initialTemplate: SerializedFormTemplate | null;
}

export function FormTemplateBuilderWorkspace({
  initialTemplate,
}: FormTemplateBuilderWorkspaceProps) {
  const router = useRouter();
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(
    initialTemplate?.fields[0]?.id ?? null,
  );
  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(
    initialTemplate?.id ?? null,
  );

  const form = useForm<TemplateBuilderInput, undefined, TemplateBuilderValues>({
    resolver: zodResolver(templateBuilderSchema),
    defaultValues: buildTemplateDefaults(initialTemplate),
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

  function handleAddField(type: FormFieldTypeValues) {
    const nextField = createCustomFormField(type, watchedFields.length, "template");
    nextField.sourceTemplateFieldId = nextField.id;
    fieldArray.append(nextField);
    setSelectedFieldId(nextField.id);
    setIsPreviewMode(false);
  }

  function handleRemoveField(index: number) {
    const field = watchedFields[index];

    if (!field || field.isMandatory) {
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

  async function onSubmit(values: TemplateBuilderValues) {
    try {
      const saveUrl = currentTemplateId
        ? `/api/dashboard/forms/templates/${currentTemplateId}`
        : "/api/dashboard/forms/templates";
      const response = await fetch(saveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title.trim(),
          description: values.description.trim(),
          status: values.status,
          fields: reorderFormFields(values.fields),
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        templateId?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save the template");
      }

      if (payload.templateId) {
        setCurrentTemplateId(payload.templateId);
      }

      toast.success("Template saved", {
        description:
          "The reusable registration template is now available for future events.",
      });

      if (!currentTemplateId && payload.templateId) {
        router.push(`/dashboard/forms/templates/${payload.templateId}`);
      }

      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("Unable to save the template", {
        description: "Please try again in a moment.",
      });
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Form template"
        title={
          initialTemplate
            ? `Edit template: ${initialTemplate.title}`
            : "Build a reusable registration template."
        }
        description="Templates keep recurring registration patterns organized so new event forms can start from a proven structure instead of rebuilding from scratch."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/dashboard/forms/templates">Back to templates</Link>
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
                  Save template
                </>
              )}
            </Button>
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
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-2xl text-slate-950">
                      Field palette
                    </CardTitle>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
                          aria-label="About the field palette"
                        >
                          <Info className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent sideOffset={6}>
                        Add reusable registration questions into the template.
                      </TooltipContent>
                    </Tooltip>
                  </div>
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
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-orange-900 shadow-sm">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex min-h-10 items-center">
                        <p className="text-sm font-semibold text-slate-950">
                          {field.title}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                  <Blocks className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-2xl text-slate-950">
                      {isPreviewMode ? "Participant preview" : "Template canvas"}
                    </CardTitle>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
                          aria-label={
                            isPreviewMode
                              ? "About the participant preview"
                              : "About the template canvas"
                          }
                        >
                          <Info className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent sideOffset={6}>
                        {isPreviewMode
                          ? "Preview how future event forms and participants will see this registration structure."
                          : "Reorder template fields with drag and drop, then select one to edit its settings."}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 px-6 pb-6 pt-0">
              <div className="grid gap-5">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Template title</FormLabel>
                      <FormControl>
                        <Input
                          className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                          placeholder="Registration template"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          className="min-h-24 rounded-[1.5rem] border-slate-200 bg-slate-50"
                          placeholder="Describe when this template should be used."
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
                          <option value="active">Active</option>
                          <option value="archived">Archived</option>
                        </select>
                      </FormControl>
                      <FormDescription>
                        Archived templates stay readable but should no longer be offered by default in the event form chooser.
                      </FormDescription>
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
                      This read-only preview mirrors how new event forms inherit the template layout.
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
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-2xl text-slate-950">
                      Field settings
                    </CardTitle>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
                          aria-label="About field settings"
                        >
                          <Info className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent sideOffset={6}>
                        Tune labels, helper text, and validation for the selected
                        template field.
                      </TooltipContent>
                    </Tooltip>
                  </div>
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
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`fields.${selectedFieldIndex}.required`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Required</FormLabel>
                        <FormControl>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[#ff7a59]"
                            checked={field.value}
                            onChange={(event) => field.onChange(event.target.checked)}
                            disabled={selectedField.isMandatory}
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
                  Select a field from the template canvas to edit its settings.
                </div>
              )}
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  );
}
