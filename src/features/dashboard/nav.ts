import {
  FileStack,
  Inbox,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Tag,
  Ticket,
} from "lucide-react";

import type { DashboardNavItem } from "@/features/dashboard/types";

export const dashboardNavItems: DashboardNavItem[] = [
  {
    title: "Overview",
    href: "/dashboard",
    icon: LayoutDashboard,
    exact: true,
    description: "Summary, quick actions, and setup progress.",
  },
  {
    title: "Events",
    href: "/dashboard/events",
    icon: Ticket,
    description: "Create, review, and organize every event.",
  },
  {
    title: "Forms",
    href: "/dashboard/forms",
    icon: FileStack,
    description: "Browse event-owned forms across the workspace.",
  },
  {
    title: "Responses",
    href: "/dashboard/responses",
    icon: Inbox,
    description: "Review attendee submissions and updates.",
  },
  {
    title: "Promotions",
    href: "/dashboard/promotions",
    icon: Tag,
    description: "Discount templates and active promotion codes.",
  },
  {
    title: "Users & Access",
    href: "/dashboard/iam",
    icon: ShieldCheck,
    description: "Invite members and shape workspace access.",
  },
  {
    title: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
    description: "Workspace profile and future team settings.",
  },
];
