import Link from "next/link";
import { Building2, ShieldCheck, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { OrgLogoUpload } from "@/features/iam/components/org-logo-upload";
import { UserAvatarUpload } from "@/features/iam/components/user-avatar-upload";

export default async function DashboardSettingsPage() {
  const scope = await getDashboardScope();

  const orgName = scope.organization?.name ?? "Organization";
  const orgLogoUrl = scope.organization?.logoUrl ?? null;
  const userName = scope.userDoc.name;
  const userAvatarUrl = scope.userDoc.avatarUrl ?? null;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Settings"
        title="Workspace & profile settings"
        description="Manage your organization logo, your profile picture, and workspace preferences."
      />

      {/* Profile images */}
      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
            Images
          </CardDescription>
          <CardTitle className="mt-2 text-2xl text-slate-950">
            Organization &amp; profile pictures
          </CardTitle>
          <CardDescription className="mt-2 text-sm leading-7 text-slate-600">
            The organization logo appears in the dashboard sidebar. Your profile
            picture appears in the header and any place your account is shown.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 px-6 pb-6 pt-0">
          <OrgLogoUpload orgName={orgName} currentLogoUrl={orgLogoUrl} />
          <Separator />
          <UserAvatarUpload
            userName={userName}
            currentAvatarUrl={userAvatarUrl}
          />
        </CardContent>
      </Card>

      {/* Placeholder sections */}
      <section className="grid gap-6 xl:grid-cols-3">
        {[
          {
            title: "Organization profile",
            description:
              "Name, slug, domain, and workspace status will eventually live here.",
            icon: Building2,
          },
          {
            title: "Roles and permissions",
            description:
              "Future member controls can be layered in without changing the dashboard shell.",
            icon: ShieldCheck,
          },
          {
            title: "Workspace members",
            description:
              "Invite links, codes, and membership visibility can grow here later.",
            icon: Users,
          },
        ].map((item) => (
          <Card
            key={item.title}
            className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]"
          >
            <CardHeader className="px-6 pt-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                <item.icon className="h-5 w-5" />
              </div>
              <CardTitle className="text-2xl text-slate-950">
                {item.title}
              </CardTitle>
              <CardDescription className="text-sm leading-7 text-slate-600">
                {item.description}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <Card className="rounded-[2rem] border-white/70 bg-slate-950 py-0 text-white shadow-[0_24px_60px_-42px_rgba(15,23,42,0.55)]">
        <CardHeader className="px-6 pt-6">
          <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-100">
            Next steps
          </CardDescription>
          <CardTitle className="text-2xl">
            Use settings to prepare for later org features
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-6 pt-0 text-sm leading-7 text-slate-200">
          <p>
            The first version keeps settings lightweight so events, forms, and
            responses stay the main focus.
          </p>
          <Button
            asChild
            className="rounded-full bg-white text-slate-950 hover:bg-orange-50"
          >
            <Link href="/dashboard">Back to Overview</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
