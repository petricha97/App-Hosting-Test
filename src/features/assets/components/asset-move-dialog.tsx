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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AssetFolderOption, SerializedAssetNode } from "@/features/assets/utils";

const ROOT_FOLDER_OPTION = "__root__";

interface AssetMoveDialogProps {
  open: boolean;
  node: SerializedAssetNode | null;
  options: AssetFolderOption[];
  submitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (parentId: string | null) => Promise<void>;
}

export function AssetMoveDialog({
  open,
  node,
  options,
  submitting = false,
  onOpenChange,
  onSubmit,
}: AssetMoveDialogProps) {
  const [value, setValue] = useState(ROOT_FOLDER_OPTION);
  const [error, setError] = useState("");

  const filteredOptions = useMemo(() => {
    if (!node) {
      return options;
    }

    return options.filter((option) => option.id !== node.id);
  }, [node, options]);

  useEffect(() => {
    if (open) {
      setValue(node?.parentId ?? ROOT_FOLDER_OPTION);
      setError("");
    }
  }, [node, open]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await onSubmit(value === ROOT_FOLDER_OPTION ? null : value);
      onOpenChange(false);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Unable to move item.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form className="space-y-5" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Move item</DialogTitle>
            <DialogDescription>
              Choose a destination folder for {node?.name ?? "this item"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Select value={value} onValueChange={setValue} disabled={submitting}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a folder" />
              </SelectTrigger>
              <SelectContent>
                {filteredOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
