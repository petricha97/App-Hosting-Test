import {
  BarChart3,
  CircleDollarSign,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  Mail,
  QrCode,
  Route,
  Tags,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface EventNavItem {
  title: string;
  /** Route segment under /dashboard/events/[eventId]/ — "" for Overview. */
  segment: string;
  icon: LucideIcon;
  /** Match the pathname exactly instead of by prefix. */
  exact?: boolean;
  /** Renders the shared ComingSoon placeholder until its milestone lands. */
  comingSoon?: boolean;
  /** Milestone tag shown on the placeholder page (e.g. "M1"). */
  milestone?: string;
  /** One-line description used by the ComingSoon placeholder. */
  description?: string;
}

export interface EventNavGroup {
  label: string;
  items: EventNavItem[];
}

export const eventNavGroups: EventNavGroup[] = [
  {
    label: "Event",
    items: [
      { title: "Overview", segment: "", icon: LayoutDashboard, exact: true },
    ],
  },
  {
    label: "Build",
    items: [
      {
        title: "Website / Pages",
        segment: "page-builder",
        icon: LayoutTemplate,
      },
      { title: "Registration Form", segment: "form", icon: ClipboardList },
    ],
  },
  {
    label: "Registration",
    items: [
      { title: "Ticket Types", segment: "tickets", icon: Ticket },
      { title: "Pricing", segment: "pricing", icon: CircleDollarSign },
      {
        title: "Registration Types",
        segment: "registration-types",
        icon: Tags,
      },
      {
        title: "Registration Paths",
        segment: "registration-paths",
        icon: Route,
      },
    ],
  },
  {
    label: "Engage & Manage",
    items: [
      {
        title: "Emails",
        segment: "emails",
        icon: Mail,
      },
      { title: "Attendees", segment: "attendees", icon: Users },
      { title: "Check-in", segment: "checkin", icon: QrCode },
      { title: "Reports", segment: "reports", icon: BarChart3 },
      { title: "Responses", segment: "responses", icon: Inbox },
    ],
  },
];

export function buildEventNavHref(eventId: string, segment: string) {
  const base = `/dashboard/events/${encodeURIComponent(eventId)}`;
  return segment ? `${base}/${segment}` : base;
}

export function getEventNavItem(segment: string): EventNavItem | undefined {
  for (const group of eventNavGroups) {
    const item = group.items.find((candidate) => candidate.segment === segment);
    if (item) {
      return item;
    }
  }
  return undefined;
}
