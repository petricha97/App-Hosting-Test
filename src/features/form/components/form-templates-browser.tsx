"use client";

import Link from "next/link";
import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";

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

interface TemplateBrowserTemplate {
  id: string;
  title: string;
  description: string;
  status: "active" | "archived";
  version: number;
}

export interface TemplateBrowserItem {
  template: TemplateBrowserTemplate;
  linkedCount: number;
}

interface FormTemplatesBrowserProps {
  templates: TemplateBrowserItem[];
}

type TemplateViewMode = "cards" | "table";

function TemplateCard({
  template,
  linkedCount,
}: TemplateBrowserItem) {
  return (
    <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
      <CardHeader className="px-6 pt-6">
        <CardTitle className="text-2xl text-slate-950">
          {template.title}
        </CardTitle>
        <CardDescription>
          {template.description || "No description yet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-6 pb-6 pt-0">
        <div className="grid gap-3 text-sm text-slate-600 md:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 px-4 py-3 shadow-sm">
            Version {template.version}
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 capitalize shadow-sm">
            {template.status}
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 shadow-sm">
            {linkedCount} linked forms
          </div>
        </div>
        <Button asChild className="rounded-full">
          <Link href={`/dashboard/forms/templates/${template.id}`}>
            Open template
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function FormTemplatesBrowser({
  templates,
}: FormTemplatesBrowserProps) {
  const [viewMode, setViewMode] = useState<TemplateViewMode>("cards");

  if (!templates.length) {
    return (
      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-2xl text-slate-950">
            No templates yet
          </CardTitle>
          <CardDescription>
            Create the first reusable registration template for this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-0">
          <Button asChild className="rounded-full">
            <Link href="/dashboard/forms/templates/new">Create template</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <div className="flex h-11 items-center rounded-full border border-slate-200 bg-slate-50 p-1">
          <Button
            type="button"
            variant={viewMode === "cards" ? "default" : "ghost"}
            size="sm"
            className="rounded-full"
            onClick={() => setViewMode("cards")}
          >
            <LayoutGrid className="mr-2 h-4 w-4" />
            Cards
          </Button>
          <Button
            type="button"
            variant={viewMode === "table" ? "default" : "ghost"}
            size="sm"
            className="rounded-full"
            onClick={() => setViewMode("table")}
          >
            <List className="mr-2 h-4 w-4" />
            Table
          </Button>
        </div>
      </div>

      {viewMode === "cards" ? (
        <section className="grid gap-6 lg:grid-cols-2">
          {templates.map((item) => (
            <TemplateCard
              key={item.template.id}
              template={item.template}
              linkedCount={item.linkedCount}
            />
          ))}
        </section>
      ) : (
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardContent className="px-6 pb-6 pt-6">
            <div className="overflow-x-auto rounded-[1.5rem] border border-slate-200 bg-slate-50/80">
              <Table aria-label="Form templates" className="min-w-[56rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-64">Template</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Linked forms</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map(({ template, linkedCount }) => (
                    <TableRow key={template.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-slate-950">{template.title}</p>
                          <p className="text-sm text-slate-600">
                            {template.description || "No description yet."}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="capitalize text-slate-600">
                        {template.status}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        Version {template.version}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {linkedCount}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" className="rounded-full">
                          <Link href={`/dashboard/forms/templates/${template.id}`}>
                            Open
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
