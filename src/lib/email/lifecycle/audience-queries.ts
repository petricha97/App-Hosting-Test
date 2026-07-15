// The six §6 audience segment queries, generic and reused by §3/§4/§5 (spec
// agents/docs/specs/m6-lifecycle-triggers.md §6). Every query is BOUNDED and
// CURSOR-PAGINATED (§8 volume safety) — never an unbounded read, never a
// single call that could hand an unbounded array to sendEventEmailBatch.
import "server-only";

import {
  getAdminAttendeeBySubmissionId,
  listAdminAttendeesForEvent,
} from "@/lib/db/adminAttendee";
import { listAdminFormDataForEventByStatuses } from "@/lib/db/adminFormData";
import { listAdminOrdersForEventByPaymentStatus } from "@/lib/db/adminOrder";
import { getAdminRegistrationDraftsForEvent } from "@/lib/db/adminRegistrationDraft";
import type {
  AttendeeDoc,
  EmailDefinitionAudience,
  FormDataDoc,
  OrderDoc,
  PaymentStatus,
  WithId,
} from "@/types/collection";
import type { AudienceCandidate, AudiencePageResult } from "./types";

// Bounded page size for a segment query — mid-point of the 50–200 range this
// codebase's admin lists already use (spec §8: "Attendee/FormData/
// RegistrationDraft lists all page at 50, EmailDefinition at up to 200").
export const LIFECYCLE_AUDIENCE_PAGE_SIZE = 100;

function timestampToMs(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { toMillis?: () => number; seconds?: number };
  if (typeof candidate.toMillis === "function") return candidate.toMillis();
  if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  return null;
}

function fullName(
  firstName: string,
  lastName: string,
  fallback: string,
): string {
  const name = `${firstName} ${lastName}`.trim();
  return name.length > 0 ? name : fallback;
}

// ---------------------------------------------------------------------------
// `abandoned` — RegistrationDraft where isAbandoned (§3's exact source).
// ---------------------------------------------------------------------------
async function queryAbandonedAudiencePage(input: {
  eventId: string;
  organizationId: string;
  limit: number;
  startAfterMs: number | null;
  nowMs: number;
}): Promise<AudiencePageResult> {
  const items = await getAdminRegistrationDraftsForEvent({
    eventId: input.eventId,
    organizationId: input.organizationId,
    limit: input.limit,
    nowMs: input.nowMs,
    startAfterUpdatedAtMs: input.startAfterMs ?? undefined,
  });

  const candidates: AudienceCandidate[] = [];
  for (const draft of items) {
    // Eligibility net (spec §3): abandoned AND a non-empty email denorm — a
    // draft abandoned mid-step-1 has no address to send to.
    if (!draft.isAbandoned) continue;
    const email = (draft.email ?? "").trim();
    candidates.push({
      recipientKey: draft.id,
      recipient: {
        name: fullName(
          draft.firstName ?? "",
          draft.lastName ?? "",
          "Registrant",
        ),
        email,
      },
      attendeeId: null,
      submissionId: null,
      orderId: null,
      orderCreatedAtMs: null,
      mergeInput: {
        submission: {
          first_name: draft.firstName ?? "",
          last_name: draft.lastName ?? "",
          email,
        },
      },
    });
  }

  const last = items[items.length - 1];
  const hasMore = items.length === input.limit;
  return {
    candidates,
    nextCursorMs:
      hasMore && last ? (timestampToMs(last.updatedAt) ?? null) : null,
    hasMore,
  };
}

// ---------------------------------------------------------------------------
// `pending-approval` — FormData status IN [new, pending, reviewed].
// ---------------------------------------------------------------------------
function submissionValue(
  submission: Record<string, string>,
  key: string,
): string {
  return submission[key] ?? "";
}

function formDataCandidate(doc: WithId<FormDataDoc>): AudienceCandidate {
  const email = submissionValue(doc.submission, "email");
  const name = fullName(
    submissionValue(doc.submission, "first_name"),
    submissionValue(doc.submission, "last_name"),
    "Registrant",
  );
  return {
    recipientKey: doc.id,
    recipient: { name, email },
    attendeeId: null,
    submissionId: doc.id,
    orderId: null,
    orderCreatedAtMs: null,
    mergeInput: { submission: doc.submission },
  };
}

async function queryPendingApprovalAudiencePage(input: {
  eventId: string;
  organizationId: string;
  limit: number;
  startAfterMs: number | null;
}): Promise<AudiencePageResult> {
  const items = await listAdminFormDataForEventByStatuses({
    eventId: input.eventId,
    organizationId: input.organizationId,
    statuses: ["new", "pending", "reviewed"],
    limit: input.limit,
    startAfterSubmittedAtMs: input.startAfterMs ?? undefined,
  });

  const last = items[items.length - 1];
  const hasMore = items.length === input.limit;
  return {
    candidates: items.map(formDataCandidate),
    nextCursorMs:
      hasMore && last ? (timestampToMs(last.submittedAt) ?? null) : null,
    hasMore,
  };
}

// ---------------------------------------------------------------------------
// `accepted-all` — Attendee.status === "accepted", no Order join.
// ---------------------------------------------------------------------------
function attendeeCandidate(attendee: WithId<AttendeeDoc>): AudienceCandidate {
  return {
    recipientKey: attendee.id,
    recipient: {
      name: fullName(attendee.firstName, attendee.lastName, attendee.email),
      email: attendee.email,
    },
    attendeeId: attendee.id,
    submissionId: attendee.submissionId,
    orderId: attendee.orderId,
    orderCreatedAtMs: null,
    mergeInput: { attendee },
  };
}

async function queryAcceptedAllAudiencePage(input: {
  eventId: string;
  organizationId: string;
  limit: number;
  startAfterMs: number | null;
}): Promise<AudiencePageResult> {
  const items = await listAdminAttendeesForEvent({
    eventId: input.eventId,
    organizationId: input.organizationId,
    status: "accepted",
    limit: input.limit,
    startAfterCreatedAtMs: input.startAfterMs ?? undefined,
  });

  const last = items[items.length - 1];
  const hasMore = items.length === input.limit;
  return {
    candidates: items.map(attendeeCandidate),
    nextCursorMs:
      hasMore && last ? (timestampToMs(last.createdAt) ?? null) : null,
    hasMore,
  };
}

// ---------------------------------------------------------------------------
// `accepted-paid` / `accepted-invoice` — Order-first traversal (the DAL gap
// this ticket closes, spec §6/§9): page the event's Orders filtered by
// paymentStatus, resolve the linked Attendee per order (bounded — at most
// one extra doc GET per order in the page), keep only Attendee.status ===
// "accepted" (the two-condition eligibility spec §4 calls out — an
// outstanding order whose submission was never accepted must NOT appear).
// ---------------------------------------------------------------------------
export interface OrderJoinedCandidate extends AudienceCandidate {
  order: WithId<OrderDoc>;
}

export async function queryOrderJoinedAcceptedAudiencePage(input: {
  eventId: string;
  organizationId: string;
  limit: number;
  startAfterMs: number | null;
  paymentStatuses: PaymentStatus[];
}): Promise<{
  page: AudiencePageResult;
  orderCandidates: OrderJoinedCandidate[];
}> {
  const orders = await listAdminOrdersForEventByPaymentStatus({
    eventId: input.eventId,
    organizationId: input.organizationId,
    paymentStatus: input.paymentStatuses,
    limit: input.limit,
    startAfterCreatedAtMs: input.startAfterMs ?? undefined,
  });

  const resolved = await Promise.all(
    orders.map(async (order) => {
      if (!order.submissionId) return null;
      const attendee = await getAdminAttendeeBySubmissionId({
        submissionId: order.submissionId,
        eventId: input.eventId,
        organizationId: input.organizationId,
      });
      if (!attendee || attendee.status !== "accepted") return null;
      return { order, attendee };
    }),
  );

  const orderCandidates: OrderJoinedCandidate[] = [];
  for (const entry of resolved) {
    if (!entry) continue;
    const { order, attendee } = entry;
    orderCandidates.push({
      ...attendeeCandidate(attendee),
      orderId: order.id,
      orderCreatedAtMs: timestampToMs(order.createdAt),
      mergeInput: { attendee, order },
      order,
    });
  }

  const last = orders[orders.length - 1];
  const hasMore = orders.length === input.limit;
  return {
    page: {
      candidates: orderCandidates,
      nextCursorMs:
        hasMore && last ? (timestampToMs(last.createdAt) ?? null) : null,
      hasMore,
    },
    orderCandidates,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher — one entrypoint per §6 audience value. `all-invitees` is a
// documented no-op (Shared decisions: no Invitee/contact-list entity
// exists) — zero recipients, zero query.
// ---------------------------------------------------------------------------
export async function queryAudiencePage(input: {
  audience: EmailDefinitionAudience;
  eventId: string;
  organizationId: string;
  limit: number;
  startAfterMs: number | null;
  nowMs: number;
}): Promise<AudiencePageResult> {
  switch (input.audience) {
    case "all-invitees":
      return { candidates: [], nextCursorMs: null, hasMore: false };
    case "abandoned":
      return queryAbandonedAudiencePage(input);
    case "pending-approval":
      return queryPendingApprovalAudiencePage(input);
    case "accepted-all":
      return queryAcceptedAllAudiencePage(input);
    case "accepted-paid": {
      const { page } = await queryOrderJoinedAcceptedAudiencePage({
        ...input,
        paymentStatuses: ["paid", "comped"],
      });
      return page;
    }
    case "accepted-invoice": {
      const { page } = await queryOrderJoinedAcceptedAudiencePage({
        ...input,
        paymentStatuses: ["outstanding"],
      });
      return page;
    }
    default: {
      const exhaustive: never = input.audience;
      throw new Error(`[lifecycle] unhandled audience: ${String(exhaustive)}`);
    }
  }
}
