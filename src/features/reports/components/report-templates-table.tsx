"use client";

// Report templates catalog table (M7-T2, design §2): 5 fixed rows (name +
// description stacked, Category badge, Run/Hide + Export CSV actions) — no
// client-side fetching, REPORT_TEMPLATES is a static array.
import { Download, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  REPORT_TEMPLATES,
  type ReportTemplateId,
} from "@/features/reports/templates";

interface ReportTemplatesTableProps {
  activeTemplate: ReportTemplateId | null;
  exportingSlug: ReportTemplateId | null;
  onToggleRun: (slug: ReportTemplateId) => void;
  onExport: (slug: ReportTemplateId) => void;
}

export function ReportTemplatesTable({
  activeTemplate,
  exportingSlug,
  onToggleRun,
  onExport,
}: ReportTemplatesTableProps) {
  return (
    <Card className="overflow-hidden rounded-2xl border border-border bg-card py-0">
      <Table aria-label="Report templates">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">Report</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {REPORT_TEMPLATES.map((template) => {
            const isActive = activeTemplate === template.slug;
            const isExporting = exportingSlug === template.slug;

            return (
              <TableRow
                key={template.slug}
                data-state={isActive ? "selected" : undefined}
                className={isActive ? "bg-muted/50" : undefined}
              >
                <TableCell className="min-w-56">
                  <div className="space-y-0.5">
                    <p className="font-medium text-foreground">
                      {template.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {template.description}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="rounded-full">
                    {template.category}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant={isActive ? "secondary" : "outline"}
                      size="sm"
                      aria-expanded={isActive}
                      aria-controls="report-run-panel"
                      onClick={() => onToggleRun(template.slug)}
                    >
                      {isActive ? "Hide" : "Run"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isExporting}
                      onClick={() => onExport(template.slug)}
                    >
                      {isExporting ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Download aria-hidden="true" />
                      )}
                      Export CSV
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
