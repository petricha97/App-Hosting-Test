import { readFormDataStatus } from "@/lib/db/formDataStatus";
import type { FormDataDoc, FormDataStatus, WithId } from "@/types/collection";

export interface SerializedResponseTimestamp {
  seconds: number | null;
  nanoseconds: number | null;
  isoString: string | null;
}

export interface SerializedResponse {
  id: string;
  formId: string;
  eventId: string;
  organizationId: string;
  submission: Record<string, string>;
  submittedAt: SerializedResponseTimestamp | null;
  attendeeName: string;
  attendeeEmail: string;
  eventName: string;
  submissionPreview: string[];
  // M3-T4: read-time defaults — legacy docs surface as "new" with null
  // ticket/order, never rewritten (src/lib/db/formDataStatus.ts).
  status: FormDataStatus;
  ticketLabel: string | null;
  orderId: string | null;
}

function serializeTimestamp(value: FormDataDoc["submittedAt"]): SerializedResponseTimestamp | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const seconds = "seconds" in value ? Number(value.seconds) : null;
  const nanoseconds = "nanoseconds" in value ? Number(value.nanoseconds) : null;
  const isoString =
    typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate().toISOString()
      : seconds !== null
        ? new Date(seconds * 1000).toISOString()
        : null;

  return {
    seconds,
    nanoseconds,
    isoString,
  };
}

function buildAttendeeName(submission: Record<string, string>) {
  const first = submission.first_name?.trim();
  const last = submission.last_name?.trim();
  const fullName = [first, last].filter(Boolean).join(" ").trim();

  if (fullName) {
    return fullName;
  }

  return submission.email?.trim() || "Unnamed attendee";
}

function buildSubmissionPreview(submission: Record<string, string>) {
  return Object.entries(submission)
    .filter(([key]) => !["first_name", "last_name", "email"].includes(key))
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${value}`);
}

export function serializeResponses(
  responses: WithId<FormDataDoc>[],
  eventNamesById: Map<string, string>,
  // Server-resolved ticket-label fallbacks (T4 AC-8): responses whose
  // ticketLabel is null but whose order exists get the order-snapshot label.
  ticketLabelsById?: Map<string, string | null>,
): SerializedResponse[] {
  return responses.map((response) => ({
    id: response.id,
    formId: response.formId,
    eventId: response.eventId,
    organizationId: response.organizationId,
    submission: response.submission,
    submittedAt: serializeTimestamp(response.submittedAt),
    attendeeName: buildAttendeeName(response.submission),
    attendeeEmail: response.submission.email?.trim() || "No email provided",
    eventName: eventNamesById.get(response.eventId) ?? "Unknown event",
    submissionPreview: buildSubmissionPreview(response.submission),
    status: readFormDataStatus(response),
    ticketLabel:
      response.ticketLabel ?? ticketLabelsById?.get(response.id) ?? null,
    orderId: response.orderId ?? null,
  }));
}

export function getResponseSubmittedLabel(response: Pick<SerializedResponse, "submittedAt">) {
  const submittedAt = response.submittedAt?.isoString;

  if (!submittedAt) {
    return "Submitted time unavailable";
  }

  const date = new Date(submittedAt);

  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
