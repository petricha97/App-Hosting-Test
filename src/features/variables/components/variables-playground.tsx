"use client";

import { useMemo, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { BuiltInVariable, SerializedVariable } from "@/features/variables/utils";
import { resolveVariables } from "@/features/variables/utils";

interface VariablesPlaygroundProps {
  title: string;
  description: string;
  initialText: string;
  organizationVariables: SerializedVariable[];
  eventVariables?: SerializedVariable[];
  organizationBuiltIns: BuiltInVariable[];
  eventBuiltIns?: BuiltInVariable[];
}

export function VariablesPlayground({
  title,
  description,
  initialText,
  organizationVariables,
  eventVariables = [],
  organizationBuiltIns,
  eventBuiltIns = [],
}: VariablesPlaygroundProps) {
  const [text, setText] = useState(initialText);

  const resolution = useMemo(
    () =>
      resolveVariables({
        text,
        organizationVariables,
        eventVariables,
        organizationBuiltIns,
        eventBuiltIns,
      }),
    [
      eventBuiltIns,
      eventVariables,
      organizationBuiltIns,
      organizationVariables,
      text,
    ],
  );

  return (
    <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
      <CardHeader className="px-6 pt-6">
        <CardTitle className="text-2xl text-slate-950">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 px-6 pb-6 pt-0 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            Input
          </p>
          <Textarea
            rows={10}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Resolved preview
            </p>
            <div className="min-h-48 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4 text-sm leading-7 text-slate-700 whitespace-pre-wrap">
              {resolution.output || "Nothing to preview yet."}
            </div>
          </div>

          {resolution.unknownKeys.length ? (
            <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Unknown tokens:{" "}
              <span className="font-mono">
                {resolution.unknownKeys
                  .map((key) => `{{${key}}}`)
                  .join(", ")}
              </span>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
