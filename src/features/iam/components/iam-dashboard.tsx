import {
  BadgeCheck,
  KeyRound,
  MailPlus,
  Shield,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";

const memberSummaries = [
  {
    name: "Farhan",
    email: "chromeeagle99@gmail.com",
    role: "Owner",
    status: "Active",
    groups: ["Organization Admin", "Events Manager"],
    access: "Full workspace access",
  },
  {
    name: "Alicia Tan",
    email: "alicia@example.com",
    role: "Admin",
    status: "Active",
    groups: ["Forms Manager"],
    access: "Manages forms, templates, and responses",
  },
  {
    name: "Marcus Lee",
    email: "marcus@example.com",
    role: "Member",
    status: "Pending",
    groups: ["Read Only"],
    access: "Can review published events and response summaries",
  },
];

const pendingInvites = [
  {
    email: "ops@example.com",
    role: "Admin",
    groups: ["Events Manager"],
    expires: "May 13, 2026",
    status: "Pending",
  },
  {
    email: "finance@example.com",
    role: "Member",
    groups: ["Read Only"],
    expires: "May 10, 2026",
    status: "Pending",
  },
];

const permissionGroups = [
  {
    name: "Organization Admin",
    description: "Broad operational control across events, pages, forms, and org settings.",
    permissions: ["Manage events", "Manage forms", "Manage users", "Manage organization"],
    members: 1,
    system: true,
  },
  {
    name: "Events Manager",
    description: "Owns event setup, event pages, and registration readiness work.",
    permissions: ["Manage events", "Manage custom pages", "View responses"],
    members: 2,
    system: false,
  },
  {
    name: "Read Only",
    description: "Great for stakeholders who only need visibility into published work.",
    permissions: ["View events", "View forms", "View responses"],
    members: 3,
    system: true,
  },
];

const summaryCards = [
  {
    title: "Members",
    value: "3",
    description: "People currently attached to this workspace.",
    icon: Users,
  },
  {
    title: "Pending invites",
    value: "2",
    description: "Invites waiting for acceptance.",
    icon: MailPlus,
  },
  {
    title: "Permission groups",
    value: "3",
    description: "Reusable access bundles for easier management.",
    icon: KeyRound,
  },
];

export function IamDashboard() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Users & Access"
        title="Keep workspace access organized before IAM is fully wired."
        description="This placeholder page focuses on the owner workflow: invite people, review members, and shape reusable permission groups."
        actions={
          <>
            <Button variant="outline" className="rounded-full">
              Invite member
            </Button>
            <Button className="rounded-full">Create group</Button>
          </>
        }
      />

      <section className="grid gap-6 xl:grid-cols-3">
        {summaryCards.map((card) => (
          <Card
            key={card.title}
            className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]"
          >
            <CardHeader className="px-6 pt-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-900">
                    {card.title}
                  </CardDescription>
                  <CardTitle className="mt-2 text-4xl text-slate-950">
                    {card.value}
                  </CardTitle>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                  <card.icon className="h-5 w-5" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-0 text-sm leading-7 text-slate-600">
              {card.description}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 2xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-2xl text-slate-950">Members</CardTitle>
                <CardDescription>
                  Placeholder data for the future org member directory.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {memberSummaries.map((member) => (
              <div
                key={member.email}
                className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-slate-950">
                        {member.name}
                      </p>
                      <Badge className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-900 shadow-none">
                        {member.role}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 shadow-none"
                      >
                        {member.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-600">{member.email}</p>
                    <p className="text-sm leading-6 text-slate-500">
                      {member.access}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {member.groups.map((group) => (
                        <Badge
                          key={group}
                          variant="outline"
                          className="rounded-full border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-700 shadow-none"
                        >
                          {group}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="rounded-full">
                      Change role
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-full">
                      Edit access
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                  <MailPlus className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-2xl text-slate-950">Invites</CardTitle>
                  <CardDescription>
                    Future invites will let owners onboard teammates without touching Firebase directly.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0">
              {pendingInvites.map((invite) => (
                <div
                  key={invite.email}
                  className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-950">
                        {invite.email}
                      </p>
                      <Badge
                        variant="secondary"
                        className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 shadow-none"
                      >
                        {invite.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-600">
                      Role: {invite.role} · Expires {invite.expires}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {invite.groups.map((group) => (
                        <Badge
                          key={group}
                          variant="outline"
                          className="rounded-full border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-700 shadow-none"
                        >
                          {group}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-slate-950 py-0 text-white shadow-[0_24px_60px_-42px_rgba(15,23,42,0.55)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-orange-100">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <CardDescription className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-100">
                    Owner-only in v1
                  </CardDescription>
                  <CardTitle className="text-2xl">Suggested guardrails</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-6 pb-6 pt-0 text-sm leading-7 text-slate-200">
              <div className="flex items-start gap-3">
                <BadgeCheck className="mt-1 h-4 w-4 text-orange-200" />
                <p>Only owners manage invites, groups, and direct permission edits in the first version.</p>
              </div>
              <div className="flex items-start gap-3">
                <BadgeCheck className="mt-1 h-4 w-4 text-orange-200" />
                <p>Members should inherit a role preset or group instead of hand-editing every permission by default.</p>
              </div>
              <div className="flex items-start gap-3">
                <BadgeCheck className="mt-1 h-4 w-4 text-orange-200" />
                <p>Never allow the final owner to lose owner access without an explicit ownership transfer flow.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-2xl text-slate-950">Permission groups</CardTitle>
              <CardDescription>
                Mocked access bundles that make future IAM management easier to reason about.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 px-6 pb-6 pt-0 xl:grid-cols-3">
          {permissionGroups.map((group) => (
            <div
              key={group.name}
              className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-slate-950">{group.name}</p>
                <Badge
                  variant={group.system ? "secondary" : "outline"}
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] shadow-none"
                >
                  {group.system ? "System" : "Custom"}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {group.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {group.permissions.map((permission) => (
                  <Badge
                    key={permission}
                    variant="outline"
                    className="rounded-full border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-700 shadow-none"
                  >
                    {permission}
                  </Badge>
                ))}
              </div>
              <p className="mt-4 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                {group.members} member{group.members === 1 ? "" : "s"} assigned
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
