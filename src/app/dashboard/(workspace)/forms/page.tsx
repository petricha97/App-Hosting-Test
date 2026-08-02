import Link from "next/link";

import { FileStack, LayoutTemplate } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminEventsForOrganization } from "@/lib/db/adminEvent";
import { getAdminFormsForOrganization } from "@/lib/db/adminForm";
import { getAdminFormTemplatesForOrganization } from "@/lib/db/adminFormTemplate";

export default async function DashboardFormsPage() {
  const scope = await getDashboardScope();
  const [events, forms, templates] = await Promise.all([
    getAdminEventsForOrganization(scope.organizationId),
    getAdminFormsForOrganization(scope.organizationId),
    getAdminFormTemplatesForOrganization(scope.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Button asChild variant="outline">
          <Link href="/dashboard/forms/templates">Open templates</Link>
        </Button>
        <Button asChild>
          <Link href="/dashboard/forms/templates/new">New template</Link>
        </Button>
      </div>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                <FileStack className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-2xl text-slate-950">Event forms</CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-0">
            <p className="text-4xl font-semibold text-slate-950">{forms.length}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {events.length} events are currently available in the organization scope.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                <LayoutTemplate className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-2xl text-slate-950">Templates</CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-0">
            <p className="text-4xl font-semibold text-slate-950">{templates.length}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Active and archived templates live together inside the workspace library.
            </p>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              Use templates when your team repeats the same registration structure across multiple events and wants a safer way to roll updates forward.
            </p>
            <Button
              asChild
              className="mt-4 rounded-full"
            >
              <Link href="/dashboard/forms/templates">Browse templates</Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <CardTitle className="text-2xl text-slate-950">
              Recent event forms
            </CardTitle>
            <CardDescription>
              Each form remains attached to its event, even when it began from a template.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {forms.length ? (
              forms.slice(0, 6).map((form) => (
                <div
                  key={form.id}
                  className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{form.title}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        Event ID: {form.eventId}
                      </p>
                    </div>
                    <Button asChild variant="outline" className="rounded-full">
                      <Link href={`/dashboard/events/${form.eventId}/form`}>
                        Open builder
                      </Link>
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-600">
                No event forms have been created yet.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <CardTitle className="text-2xl text-slate-950">
              Template library
            </CardTitle>
            <CardDescription>
              Templates can be updated later and applied to linked event forms.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {templates.length ? (
              templates.slice(0, 6).map((template) => (
                <div
                  key={template.id}
                  className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        {template.title}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Version {template.version} • {template.status}
                      </p>
                    </div>
                    <Button asChild variant="outline" className="rounded-full">
                      <Link href={`/dashboard/forms/templates/${template.id}`}>
                        Manage template
                      </Link>
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-600">
                No templates yet. Create one to reuse the same registration structure across future events.
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
