import type {
  DashboardSummaryCard,
  EventListItem,
  FormListItem,
  ResponseListItem,
} from "@/features/dashboard/types";

export const overviewSummaryCards: DashboardSummaryCard[] = [
  {
    title: "Draft events",
    value: "03",
    hint: "Three event ideas are waiting for content and dates.",
  },
  {
    title: "Published events",
    value: "00",
    hint: "No live events yet. Publish the first one when ready.",
  },
  {
    title: "Active forms",
    value: "02",
    hint: "Two event forms are in setup and need field review.",
  },
  {
    title: "New responses",
    value: "00",
    hint: "Responses will appear here once registrations open.",
  },
];

export const placeholderEvents: EventListItem[] = [
  {
    id: "tech-meetup-2026",
    name: "Tech Meetup 2026",
    status: "Draft",
    dateLabel: "Choose dates and schedule blocks",
    responseLabel: "No responses yet",
    formStatus: "Form setup pending",
  },
  {
    id: "design-breakfast",
    name: "Design Breakfast",
    status: "Published",
    dateLabel: "Tue, Jun 18 · 9:00 AM",
    responseLabel: "24 responses collected",
    formStatus: "Registration form live",
  },
];

export const placeholderForms: FormListItem[] = [
  {
    id: "registration-tech-meetup",
    name: "Registration Form",
    eventName: "Tech Meetup 2026",
    fieldCount: 8,
    updatedLabel: "Updated 2 days ago",
    status: "Draft",
  },
  {
    id: "breakfast-checkin",
    name: "Breakfast RSVP",
    eventName: "Design Breakfast",
    fieldCount: 5,
    updatedLabel: "Updated today",
    status: "Live",
  },
];

export const placeholderResponses: ResponseListItem[] = [
  {
    id: "resp-001",
    eventName: "Design Breakfast",
    attendeeName: "Avery Tan",
    submittedLabel: "Submitted 2 hours ago",
    status: "New",
  },
  {
    id: "resp-002",
    eventName: "Design Breakfast",
    attendeeName: "Mika Chen",
    submittedLabel: "Reviewed yesterday",
    status: "Reviewed",
  },
];
