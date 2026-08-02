"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { normalizeVariableKey } from "@/features/variables/schema";

export interface VariableDialogValues {
  key: string;
  value: string;
  description: string;
}

interface VariableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: VariableDialogValues | null;
  title: string;
  description: string;
  submitLabel: string;
  onSubmit: (values: VariableDialogValues) => Promise<void>;
}

export function VariableDialog({
  open,
  onOpenChange,
  initialValues,
  title,
  description,
  submitLabel,
  onSubmit,
}: VariableDialogProps) {
  const [key, setKey] = useState(initialValues?.key ?? "");
  const [value, setValue] = useState(initialValues?.value ?? "");
  const [details, setDetails] = useState(initialValues?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKey(initialValues?.key ?? "");
    setValue(initialValues?.value ?? "");
    setDetails(initialValues?.description ?? "");
    setError(null);
  }, [initialValues, open]);

  const normalizedKey = useMemo(() => normalizeVariableKey(key), [key]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      await onSubmit({
        key,
        value,
        description: details,
      });
      onOpenChange(false);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Unable to save variable.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="variable-key">Key</Label>
            <Input
              id="variable-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="SUPPORT_EMAIL"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className="text-xs text-slate-500">
              Token preview:{" "}
              <span className="font-mono">
                {normalizedKey ? `{{${normalizedKey}}}` : "{{VARIABLE_NAME}}"}
              </span>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="variable-value">Value</Label>
            <Textarea
              id="variable-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="hello@eventa.com"
              rows={5}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="variable-description">Description</Label>
            <Input
              id="variable-description"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Shown to organizers only"
            />
          </div>

          {error ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
