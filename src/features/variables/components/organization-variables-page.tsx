"use client";

import { useMemo, useState } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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

interface OrganizationVariablesPageProps {
  canManage: boolean;
  builtIns: BuiltInVariable[];
  initialVariables: SerializedVariable[];
}

async function parseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return body?.error ?? fallback;
}

export function OrganizationVariablesPage({
  canManage,
  builtIns,
  initialVariables,
}: OrganizationVariablesPageProps) {
  const [variables, setVariables] = useState(initialVariables);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVariable, setEditingVariable] = useState<SerializedVariable | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const initialPlaygroundText = useMemo(() => {
    return "Welcome to {{ORGANIZATION_NAME}}.\nContact us at {{SUPPORT_EMAIL}}.";
  }, []);

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    toast.success("Token copied");
  }

  async function handleCreateOrUpdate(values: VariableDialogValues) {
    const isEditing = Boolean(editingVariable);
    const response = await fetch(
      isEditing
        ? `/api/dashboard/variables/${encodeURIComponent(editingVariable!.id)}`
        : "/api/dashboard/variables",
      {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      },
    );

    if (!response.ok) {
      throw new Error(
        await parseError(response, "Unable to save organization variable."),
      );
    }

    const payload = (await response.json()) as { variable: SerializedVariable };
    setVariables((current) => {
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
        `/api/dashboard/variables/${encodeURIComponent(variable.id)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        toast.error(await parseError(response, "Unable to delete variable."));
        return;
      }

      setVariables((current) =>
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
            Add variable
          </Button>
        ) : null}
      </div>

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-2xl text-slate-950">Built-in defaults</CardTitle>
          <CardDescription>Read-only organization values you can reuse immediately.</CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-0">
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
              {builtIns.map((variable) => (
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
        </CardContent>
      </Card>

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-2xl text-slate-950">Organization variables</CardTitle>
          <CardDescription>Shared across all events in this organization.</CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-0">
          {variables.length ? (
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
                {variables.map((variable) => (
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
              No organization variables yet.
            </div>
          )}
        </CardContent>
      </Card>

      <VariablesPlayground
        title="Resolution playground"
        description="Verify how shared organization tokens resolve before wiring them into other features."
        initialText={initialPlaygroundText}
        organizationVariables={variables}
        organizationBuiltIns={builtIns}
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
        title={editingVariable ? "Edit organization variable" : "Add organization variable"}
        description="Shared variables can be reused across multiple events in the same organization."
        submitLabel={editingVariable ? "Save changes" : "Create variable"}
        onSubmit={handleCreateOrUpdate}
      />
    </div>
  );
}
