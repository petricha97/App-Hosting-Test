"use client";

// Check-in settings card (M5-T4 AC-3, design §3): five toggle rows persisted
// per flip — OPTIMISTIC: the switch moves immediately, the PATCH runs in the
// background, and a failure flips it back with a toast. Toggles are stored
// booleans; what they gate is enforced in later milestones (documented).

import { Fragment, useState } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  CHECKIN_SETTING_ROWS,
  type CheckinSettingKey,
  type CheckinSettings,
} from "@/features/checkin/settings";

interface CheckinSettingsCardProps {
  eventId: string;
  initialSettings: CheckinSettings;
}

export function CheckinSettingsCard({
  eventId,
  initialSettings,
}: CheckinSettingsCardProps) {
  const [settings, setSettings] = useState(initialSettings);

  const toggle = async (key: CheckinSettingKey, value: boolean) => {
    const previous = settings[key];
    setSettings((current) => ({ ...current, [key]: value }));

    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/checkin/config`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        },
      );
      if (!response.ok) throw new Error("save failed");

      // Adopt the server's resulting settings (source of truth after merge).
      const data = (await response.json()) as { settings: CheckinSettings };
      setSettings(data.settings);
    } catch {
      // Rollback the optimistic flip.
      setSettings((current) => ({ ...current, [key]: previous }));
      toast.error("Couldn't save setting");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check-in settings</CardTitle>
      </CardHeader>
      <CardContent className="px-6">
        {CHECKIN_SETTING_ROWS.map((row, index) => (
          <Fragment key={row.key}>
            {index > 0 ? <Separator /> : null}
            <div className="flex items-center justify-between gap-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor={`checkin-setting-${row.key}`} className="font-medium">
                  {row.label}
                </Label>
                <p className="text-xs text-muted-foreground">{row.description}</p>
              </div>
              <Switch
                id={`checkin-setting-${row.key}`}
                checked={settings[row.key]}
                onCheckedChange={(checked) => void toggle(row.key, checked)}
              />
            </div>
          </Fragment>
        ))}
      </CardContent>
    </Card>
  );
}
