"use client";

// Report templates section (M7-T2, design §0/§1): owns the single-open
// accordion state (activeTemplate) and the shared export-busy state, and
// renders the templates table + (when a template is active) its Run panel.
// The only interactive piece this ticket adds to the Reports screen.
import { useState } from "react";

import { ReportRunPanel } from "@/features/reports/components/report-run-panel";
import { ReportTemplatesTable } from "@/features/reports/components/report-templates-table";
import {
  REPORT_TEMPLATES,
  type ReportTemplateId,
} from "@/features/reports/templates";
import { downloadCsvExport } from "@/features/responses/download";

export interface ReportTemplatesSectionProps {
  eventId: string;
}

export function ReportTemplatesSection({
  eventId,
}: ReportTemplatesSectionProps) {
  const [activeTemplate, setActiveTemplate] = useState<ReportTemplateId | null>(
    null,
  );
  const [exportingSlug, setExportingSlug] = useState<ReportTemplateId | null>(
    null,
  );

  const exportTemplate = async (slug: ReportTemplateId) => {
    const template = REPORT_TEMPLATES.find((entry) => entry.slug === slug);
    if (!template) return;

    setExportingSlug(slug);
    try {
      await downloadCsvExport(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/reports/${slug}/export`,
        `${template.slug}-${eventId}.csv`,
      );
    } finally {
      setExportingSlug(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          Report templates
        </h2>
        <p className="text-sm text-muted-foreground">
          Run a template for row-level detail, or export it straight to CSV.
        </p>
      </div>

      <ReportTemplatesTable
        activeTemplate={activeTemplate}
        exportingSlug={exportingSlug}
        onToggleRun={(slug) =>
          setActiveTemplate((current) => (current === slug ? null : slug))
        }
        onExport={(slug) => void exportTemplate(slug)}
      />

      {activeTemplate ? (
        <ReportRunPanel
          key={activeTemplate}
          eventId={eventId}
          slug={activeTemplate}
          exporting={exportingSlug === activeTemplate}
          onExport={() => void exportTemplate(activeTemplate)}
          onClose={() => setActiveTemplate(null)}
        />
      ) : null}
    </div>
  );
}
