"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VariableDialog, type VariableDialogValues } from "@/features/variables/components/variable-dialog";
import { VariablesPlayground } from "@/features/variables/components/variables-playground";
import type { BuiltInVariable, SerializedVariable } from "@/features/variables/utils";

interface EventVariablesPageProps {
  canManage: boolean;
  eventId: string;
  organizationBuiltIns: BuiltInVariable[];
  eventBuiltIns: BuiltInVariable[];
  organizationVariables: SerializedVariable[];
  initialEventVariables: SerializedVariable[];
}

async function parseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return body?.error ?? fallback;
}

export function EventVariablesPage({
  canManage,
  eventId,
  organizationBuiltIns,
  eventBuiltIns,
  organizationVariables,
  initialEventVariables,
}: EventVariablesPageProps) {
  const [eventVariables, setEventVariables] = useState(initialEventVariables);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVariable, setEditingVariable] = useState<SerializedVariable | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const organizationKeys = useMemo(
    () => new Set(organizationVariables.map((variable) => variable.key)),
    [organizationVariables],
  );

  const initialPlaygroundText = useMemo(() => {
    return "Welcome to {{EVENT_NAME}} from {{ORGANIZATION_NAME}}.\nNeed help? Email {{SUPPORT_EMAIL}}.";
  }, []);

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    toast.success("Token copied");
  }

  async function handleCreateOrUpdate(values: VariableDialogValues) {
    const isEditing = Boolean(editingVariable);
    const response = await fetch(
      isEditing
        ? `/api/dashboard/events/${encodeURIComponent(eventId)}/variables/${encodeURIComponent(editingVariable!.id)}`
        : `/api/dashboard/events/${encodeURIComponent(eventId)}/variables`,
      {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      },
    );

    if (!response.ok) {
      throw new Error(await parseError(response, "Unable to save event variable."));
    }

    const payload = (await response.json()) as { variable: SerializedVariable };
    setEventVariables((current) => {
      if (isEditing) {
        return current.map((entry) =>
          entry.id === payload.variable.id ? payload.variable : entry,
        );
      }

      return [payload.variable, ...current];
    });
    toast.success(isEditing ? "Variable updated" : "Variable created");
    setEditingVariable(null);
  }

  async function handleDelete(variable: SerializedVariable) {
    setDeletingId(variable.id);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/variables/${encodeURIComponent(variable.id)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        toast.error(await parseError(response, "Unable to delete variable."));
        return;
      }

      setEventVariables((current) =>
        current.filter((entry) => entry.id !== variable.id),
      );
      toast.success("Variable deleted");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-3">
        {canManage ? (
          <Button
            className="rounded-full"
            onClick={() => {
              setEditingVariable(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Add event variable
          </Button>
        ) : null}
      </div>

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-2xl text-slate-950">Organization scope</CardTitle>
          <CardDescription>
            Shared variables available to every event. Edit shared values from{" "}
            <Link href="/dashboard/variables" className="font-medium text-slate-950 underline underline-offset-4">
              the organization variables page
            </Link>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 px-6 pb-6 pt-0">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Built-in defaults
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizationBuiltIns.map((variable) => (
                  <TableRow key={variable.id}>
                    <TableCell className="font-mono text-xs">{variable.token}</TableCell>
                    <TableCell>{variable.value || "—"}</TableCell>
                    <TableCell className="whitespace-normal text-slate-600">
                      {variable.description}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => void copyToken(variable.token)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Shared custom variables
            </p>
            {organizationVariables.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="w-24 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {organizationVariables.map((variable) => (
                    <TableRow key={variable.id}>
                      <TableCell className="space-y-2 whitespace-normal">
                        <div className="font-semibold text-slate-950">{variable.key}</div>
                        <div className="font-mono text-xs text-slate-500">{variable.token}</div>
                      </TableCell>
                      <TableCell className="max-w-sm whitespace-normal break-words">
                        {variable.value}
                      </TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-slate-600">
                        {variable.description || "—"}
                      </TableCell>
                      <TableCell>{variable.updatedAtLabel}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void copyToken(variable.token)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-600">
                No organization variables yet.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-2xl text-slate-950">Event scope</CardTitle>
          <CardDescription>Local values that only resolve inside this event.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 px-6 pb-6 pt-0">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Built-in defaults
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventBuiltIns.map((variable) => (
                  <TableRow key={variable.id}>
                    <TableCell className="font-mono text-xs">{variable.token}</TableCell>
                    <TableCell>{variable.value || "—"}</TableCell>
                    <TableCell className="whitespace-normal text-slate-600">
                      {variable.description}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => void copyToken(variable.token)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Event custom variables
            </p>
            {eventVariables.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="w-32 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eventVariables.map((variable) => (
                    <TableRow key={variable.id}>
                      <TableCell className="space-y-2 whitespace-normal">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-950">{variable.key}</span>
                          {organizationKeys.has(variable.key) ? (
                            <Badge variant="outline">Overrides organization</Badge>
                          ) : null}
                        </div>
                        <div className="font-mono text-xs text-slate-500">{variable.token}</div>
                      </TableCell>
                      <TableCell className="max-w-sm whitespace-normal break-words">
                        {variable.value}
                      </TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-slate-600">
                        {variable.description || "—"}
                      </TableCell>
                      <TableCell>{variable.updatedAtLabel}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => void copyToken(variable.token)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          {canManage ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setEditingVariable(variable);
                                  setDialogOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={deletingId === variable.id}
                                onClick={() => void handleDelete(variable)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-600">
                No event variables yet.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <VariablesPlayground
        title="Resolution playground"
        description="Event custom values resolve first, then shared organization values, followed by built-in defaults."
        initialText={initialPlaygroundText}
        organizationVariables={organizationVariables}
        eventVariables={eventVariables}
        organizationBuiltIns={organizationBuiltIns}
        eventBuiltIns={eventBuiltIns}
      />

      <VariableDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingVariable(null);
        }}
        initialValues={
          editingVariable
            ? {
                key: editingVariable.key,
                value: editingVariable.value,
                description: editingVariable.description,
              }
            : null
        }
        title={editingVariable ? "Edit event variable" : "Add event variable"}
        description="Event variables only resolve inside this event and can override shared organization variables with the same key."
        submitLabel={editingVariable ? "Save changes" : "Create variable"}
        onSubmit={handleCreateOrUpdate}
      />
    </div>
  );
}
