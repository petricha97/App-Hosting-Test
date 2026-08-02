import {
  Braces,
  FileStack,
  FolderOpen,
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
  },
  {
    title: "Events",
    href: "/dashboard/events",
    icon: Ticket,
  },
  {
    title: "Forms",
    href: "/dashboard/forms",
    icon: FileStack,
  },
  {
    title: "Variables",
    href: "/dashboard/variables",
    icon: Braces,
  },
  {
    title: "Assets",
    href: "/dashboard/assets",
    icon: FolderOpen,
  },
  {
    title: "Responses",
    href: "/dashboard/responses",
    icon: Inbox,
  },
  {
    title: "Promotions",
    href: "/dashboard/promotions",
    icon: Tag,
  },
  {
    title: "Users & Access",
    href: "/dashboard/iam",
    icon: ShieldCheck,
  },
  {
    title: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
  },
];
