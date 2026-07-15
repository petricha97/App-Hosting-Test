"use client";

// Active column cell (design §1): an accessible Switch + a Badge whose TEXT
// carries the on/off meaning (never color-only). Optimistic — the parent
// owns the flip + rollback (registration-paths-workspace.tsx toggleActive
// pattern).
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

interface EmailActiveSwitchProps {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: () => void;
}

export function EmailActiveSwitch({
  name,
  checked,
  disabled = false,
  onCheckedChange,
}: EmailActiveSwitchProps) {
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={`Toggle ${name} active`}
      />
      {checked ? (
        <Badge className="rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          On
        </Badge>
      ) : (
        <Badge variant="secondary" className="rounded-full">
          Off
        </Badge>
      )}
    </div>
  );
}
