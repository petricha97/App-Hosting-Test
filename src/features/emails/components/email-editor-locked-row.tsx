"use client";

// Read-only field display for locked fields on system (isSystem:true)
// definitions (design §3 — "locked fields render as read-only, not just
// rejected server-side"). Split out of email-editor-dialog.tsx (S-1,
// M6-T2 code review) — pure extraction, no behavior change.
import { LockKeyhole } from "lucide-react";

interface EmailEditorLockedRowProps {
  label: string;
  value: string;
}

export function EmailEditorLockedRow({
  label,
  value,
}: EmailEditorLockedRowProps) {
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-1.5 text-sm text-foreground">
        <LockKeyhole
          aria-hidden="true"
          className="h-3.5 w-3.5 text-muted-foreground"
        />
        {value}
      </div>
    </div>
  );
}
