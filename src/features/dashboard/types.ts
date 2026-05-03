import type { LucideIcon } from "lucide-react";

export interface DashboardNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
  description: string;
}

export interface DashboardSummaryCard {
  title: string;
  value: string;
  hint: string;
}

export interface EventListItem {
  id: string;
  name: string;
  status: "Draft" | "Published";
  dateLabel: string;
  responseLabel: string;
  formStatus: string;
}

export interface FormListItem {
  id: string;
  name: string;
  eventName: string;
  fieldCount: number;
  updatedLabel: string;
  status: "Draft" | "Live";
}

export interface ResponseListItem {
  id: string;
  eventName: string;
  attendeeName: string;
  submittedLabel: string;
  status: "New" | "Reviewed";
}
