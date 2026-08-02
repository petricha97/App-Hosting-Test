import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminLinkedFormsForTemplate } from "@/lib/db/adminForm";
import { getAdminFormTemplatesForOrganization } from "@/lib/db/adminFormTemplate";

export default async function DashboardFormTemplatesPage() {
  const scope = await getDashboardScope();
  const templates = await getAdminFormTemplatesForOrganization(scope.organizationId);

  const templateCards = await Promise.all(
    templates.map(async (template) => {
      const linkedForms = await getAdminLinkedFormsForTemplate({
        templateId: template.id,
        organizationId: scope.organizationId,
      });

      return {
        template,
        linkedCount: linkedForms.filter((form) => !form.templateLink?.detached).length,
      };
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end sm:items-center">
        <Button asChild variant="outline">
          <Link href="/dashboard/forms">Back to forms</Link>
        </Button>
        <Button asChild>
          <Link href="/dashboard/forms/templates/new">New template</Link>
        </Button>
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        {templateCards.length ? (
          templateCards.map(({ template, linkedCount }) => (
            <Card
              key={template.id}
              className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]"
            >
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
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 shadow-sm">
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
          ))
        ) : (
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
        )}
      </section>
    </div>
  );
}
