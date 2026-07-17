// Static report-templates catalog (M7-T2). Pure data — no Firebase, no
// network I/O — safe to import from client components (the templates table
// needs zero client-side fetching to know the 5 templates exist, design §1)
// AND from server code (CSV column config, route filenames).
//
// Spec: agents/docs/specs/m7-report-templates.md (D6 slugs/categories, §1–§5
// column specs, §7 filenames, §8 empty-state copy).
// Design: agents/docs/design/m7-report-templates.md §2 (templates table),
// §3 (Run panel min-width per template), §4 (explanatory notes).
import type { LucideIcon } from "lucide-react";
import { Mail, QrCode, Receipt, Timer, Users } from "lucide-react";

export const REPORT_TEMPLATE_IDS = [
  "registration-overview",
  "order-transactions",
  "abandoned-registrations",
  "checkin-history",
  "email-overview",
] as const;

export type ReportTemplateId = (typeof REPORT_TEMPLATE_IDS)[number];

export type ReportCategory = "Attendee" | "Finance" | "Onsite" | "Email";

// One column of a template's Run table / CSV export, in exact spec order.
// `key` indexes into the loader's ReportRow (src/features/reports/types.ts).
export interface ReportColumnConfig {
  key: string;
  header: string;
  // Run table only: format the raw ISO string as a human date (design §3 —
  // the CSV cell always keeps the raw ISO string per spec §1–§5).
  isDateTime?: boolean;
  // Run table only: tabular-nums styling for money/count columns.
  isNumeric?: boolean;
}

export interface ReportEmptyStateConfig {
  icon: LucideIcon;
  title: string;
  description: string;
  // Both present together, or neither (spec §8 — Abandoned has no CTA).
  ctaLabel?: string;
  // Appended to `/dashboard/events/${eventId}/...` by the panel.
  ctaHrefSuffix?: string;
}

export interface ReportTemplateDefinition {
  slug: ReportTemplateId;
  name: string;
  description: string;
  category: ReportCategory;
  // "Couldn't load {entityLabel}" (EntityTableError).
  entityLabel: string;
  // CSV filename = `${slug}-${eventId}.csv` (spec §7 — every template's
  // filename prefix IS its slug; no separate field needed).
  minWidthClassName: string;
  columns: ReportColumnConfig[];
  emptyState: ReportEmptyStateConfig;
  // Explanatory note rendered under the panel's description (design §4) —
  // Abandoned's masked-email note, Badges-printed's check-in-history framing
  // note. Absent for the other 3 templates.
  note?: string;
}

export const REPORT_TEMPLATES: ReportTemplateDefinition[] = [
  {
    slug: "registration-overview",
    name: "Registration overview",
    description:
      "Every registrant, accepted or cancelled, with ticket and check-in detail.",
    category: "Attendee",
    entityLabel: "registrations",
    minWidthClassName: "min-w-[70rem]",
    columns: [
      { key: "name", header: "Name" },
      { key: "email", header: "Email" },
      { key: "company", header: "Company" },
      { key: "jobTitle", header: "Job title" },
      { key: "registrationType", header: "Registration type" },
      { key: "ticketType", header: "Ticket type" },
      { key: "status", header: "Status" },
      { key: "checkInState", header: "Check-in state" },
      { key: "checkedInAt", header: "Checked-in at", isDateTime: true },
      { key: "registeredAt", header: "Registered at", isDateTime: true },
    ],
    emptyState: {
      icon: Users,
      title: "No registrations yet",
      description: "Attendees will appear here once people register.",
      ctaLabel: "Go to Attendees",
      ctaHrefSuffix: "attendees",
    },
  },
  {
    slug: "order-transactions",
    name: "Order & transaction details",
    description:
      "Row-level payments, discounts, and tax lines behind the finance totals above.",
    category: "Finance",
    entityLabel: "order transactions",
    minWidthClassName: "min-w-[96rem]",
    columns: [
      { key: "orderId", header: "Order ID" },
      { key: "submissionId", header: "Submission ID" },
      { key: "ticketType", header: "Ticket type" },
      { key: "registrationType", header: "Registration type" },
      { key: "feeName", header: "Fee name" },
      { key: "currency", header: "Currency" },
      { key: "subtotal", header: "Subtotal", isNumeric: true },
      { key: "discount", header: "Discount", isNumeric: true },
      { key: "tax", header: "Tax", isNumeric: true },
      { key: "total", header: "Total", isNumeric: true },
      { key: "promoCode", header: "Promo code" },
      { key: "paymentMethod", header: "Payment method" },
      { key: "paymentStatus", header: "Payment status" },
      { key: "providerPaymentId", header: "Provider payment ID" },
      { key: "createdAt", header: "Created at", isDateTime: true },
    ],
    emptyState: {
      icon: Receipt,
      title: "No orders yet",
      description:
        "Transactions will appear here once someone completes checkout.",
      ctaLabel: "Go to Pricing",
      ctaHrefSuffix: "pricing",
    },
  },
  {
    slug: "abandoned-registrations",
    name: "Abandoned registration details",
    description:
      "The full abandoned list — masked email, last step reached, last activity.",
    category: "Attendee",
    entityLabel: "abandoned registrations",
    minWidthClassName: "min-w-[54rem]",
    columns: [
      { key: "name", header: "Name" },
      { key: "maskedEmail", header: "Email (masked)" },
      { key: "lastStepReached", header: "Last step reached" },
      { key: "ticketType", header: "Ticket type selected" },
      { key: "registrationType", header: "Registration type selected" },
      { key: "lastActivity", header: "Last activity", isDateTime: true },
    ],
    emptyState: {
      icon: Timer,
      title: "No abandoned registrations",
      description: "Registrations idle for more than 24 hours land here.",
      // No CTA — nothing to configure (spec §8, matches the Abandoned tab's
      // own existing empty state).
    },
    note:
      'Email is shown as domain only (e.g. "@example.com") to protect ' +
      "registrant privacy — the same masking applies to the CSV export.",
  },
  {
    slug: "checkin-history",
    name: "Badges printed (check-in history)",
    description:
      "Per-attendee arrival status and check-in time, based on check-in records.",
    category: "Onsite",
    entityLabel: "check-in history",
    minWidthClassName: "min-w-[58rem]",
    columns: [
      { key: "name", header: "Name" },
      { key: "email", header: "Email" },
      { key: "registrationType", header: "Registration type" },
      { key: "ticketType", header: "Ticket type" },
      { key: "checkInState", header: "Check-in state" },
      { key: "checkedInAt", header: "Checked-in at", isDateTime: true },
      { key: "checkedInBy", header: "Checked-in by" },
    ],
    emptyState: {
      icon: QrCode,
      title: "No check-ins yet",
      description: "Arrivals will appear here once attendees are checked in.",
      ctaLabel: "Go to Check-in",
      ctaHrefSuffix: "checkin",
    },
    note:
      "This reflects check-in records, not a literal count of badges " +
      "printed — no per-badge print tracking exists in this product yet.",
  },
  {
    slug: "email-overview",
    name: "Email overview",
    description:
      "Every email this event has sent or attempted, across all definitions.",
    category: "Email",
    entityLabel: "emails",
    minWidthClassName: "min-w-[72rem]",
    columns: [
      { key: "recipientName", header: "Recipient name" },
      { key: "recipientEmail", header: "Recipient email" },
      { key: "emailName", header: "Email" },
      { key: "subject", header: "Subject" },
      { key: "status", header: "Status" },
      { key: "attemptCount", header: "Attempt count", isNumeric: true },
      { key: "lastError", header: "Last error" },
      { key: "queuedAt", header: "Queued at", isDateTime: true },
      { key: "sentAt", header: "Sent at", isDateTime: true },
      { key: "failedAt", header: "Failed at", isDateTime: true },
    ],
    emptyState: {
      icon: Mail,
      title: "No emails sent yet",
      description: "Sent and queued emails will appear here.",
      ctaLabel: "Go to Emails",
      ctaHrefSuffix: "emails",
    },
  },
];

const REPORT_TEMPLATES_BY_SLUG = new Map<string, ReportTemplateDefinition>(
  REPORT_TEMPLATES.map((template) => [template.slug, template]),
);

export function getReportTemplate(
  slug: string,
): ReportTemplateDefinition | undefined {
  return REPORT_TEMPLATES_BY_SLUG.get(slug);
}

export function isReportTemplateId(value: string): value is ReportTemplateId {
  return REPORT_TEMPLATES_BY_SLUG.has(value);
}
