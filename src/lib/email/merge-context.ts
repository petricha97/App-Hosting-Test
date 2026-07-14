// Maps DAL documents onto EmailMergeContext — the "documented source" column
// of the spec §3 catalog table, in code. Callers (T3 triggers, T2 preview)
// load the docs through src/lib/db/ and hand them here; this module does NO
// I/O itself so the renderer chain stays pure and testable.
// Spec: agents/docs/specs/m6-email-infrastructure.md (§3).
//
// Value rules implemented here (renderer just places what it gets):
// - Attendee denorms win; PRE-ACCEPT sends fall back to the submission map
//   keys (first_name/last_name/email/company/job_title — same keys the
//   accept hook denormalizes, src/features/responses/on-submission-accepted.ts);
// - "—" is an ADMIN-UI-ONLY fallback label (roster/badges); in email a
//   ticket/regType that is unknown renders "" (spec table note), so the "—"
//   sentinel is mapped to absent here;
// - {order_total} formats amounts.totalMinor in the order's currency with
//   the same en-US Intl convention as formatMoney
//   (src/features/pricing/utils.ts) — "" when no order (free/legacy);
// - {payment_status} humanizes OrderDoc.paymentStatus ("Paid",
//   "Payment due", "Complimentary");
// - {event_date} reuses getEventBarDateLabel (first EventDoc.periods entry
//   formatted with the event timezone) — "" when no periods;
// - {event_url} is the public event page path (/events/{id}, the route the
//   whole public flow links to), absolutized when the caller passes a
//   baseUrl.
import "server-only";

import { getEventBarDateLabel } from "@/features/event/utils";
import type { EmailMergeContext } from "@/lib/email/merge-tags";
import type {
  AttendeeDoc,
  EventDoc,
  OrderDoc,
  PaymentStatus,
  WithId,
} from "@/types/collection";

// Admin-UI fallback label (ATTENDEE_LABEL_FALLBACK) — never rendered into
// an email; mapped to "value absent" instead.
const ADMIN_LABEL_FALLBACK = "—";

// Humanized payment statuses (spec §3 table: "Paid", "Payment due",
// "Complimentary"). "failed" reads as still-due — the registrant owes a
// retry, not an error dump.
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Payment due",
  outstanding: "Payment due",
  failed: "Payment due",
  paid: "Paid",
  comped: "Complimentary",
};

export function formatOrderTotal(order: {
  amounts: { totalMinor: number };
  currency: string;
}): string {
  // Same convention as formatMoney (src/features/pricing/utils.ts): en-US,
  // 2-minor-digit currencies only (M2 pricing-math invariant).
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: order.currency,
  }).format(order.amounts.totalMinor / 100);
}

export function publicEventUrl(eventId: string, baseUrl?: string): string {
  const path = `/events/${eventId}`;
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === ADMIN_LABEL_FALLBACK) {
    return undefined;
  }
  return trimmed;
}

export interface BuildEmailMergeContextInput {
  event?: WithId<Pick<EventDoc, "name" | "periods" | "timezone">> | null;
  attendee?: Pick<
    AttendeeDoc,
    | "firstName"
    | "lastName"
    | "email"
    | "company"
    | "jobTitle"
    | "ticketLabel"
    | "registrationTypeLabel"
  > | null;
  // Pre-accept fallback: the raw FormData submission map.
  submission?: Record<string, string> | null;
  order?: Pick<OrderDoc, "amounts" | "currency" | "paymentStatus"> | null;
  // Pre-rendered, server-minted QR SVG (mintQrToken -> QRCode.toString) —
  // built by the caller so this module (and the renderer) stay sync/pure.
  qrCodeSvg?: string | null;
  // Absolute-URL base for {event_url}; omitted = site-relative path.
  baseUrl?: string;
}

export function buildEmailMergeContext(
  input: BuildEmailMergeContextInput,
): EmailMergeContext {
  const { event, attendee, submission, order } = input;

  const fromSubmission = (key: string): string | undefined =>
    nonEmpty(submission?.[key]);

  const person = {
    firstName: nonEmpty(attendee?.firstName) ?? fromSubmission("first_name"),
    lastName: nonEmpty(attendee?.lastName) ?? fromSubmission("last_name"),
    email: nonEmpty(attendee?.email) ?? fromSubmission("email"),
    company: nonEmpty(attendee?.company) ?? fromSubmission("company"),
    jobTitle: nonEmpty(attendee?.jobTitle) ?? fromSubmission("job_title"),
  };

  return {
    eventTitle: nonEmpty(event?.name),
    eventDate: event ? (getEventBarDateLabel(event) ?? undefined) : undefined,
    ...person,
    ticketName: nonEmpty(attendee?.ticketLabel),
    registrationType: nonEmpty(attendee?.registrationTypeLabel),
    orderTotal: order ? formatOrderTotal(order) : undefined,
    paymentStatus: order
      ? PAYMENT_STATUS_LABELS[order.paymentStatus]
      : undefined,
    qrCodeSvg: input.qrCodeSvg ?? undefined,
    eventUrl: event ? publicEventUrl(event.id, input.baseUrl) : undefined,
  };
}
