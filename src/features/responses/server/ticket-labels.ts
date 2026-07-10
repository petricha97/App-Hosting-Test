// Server-side ticket-label fallback for the responses tables and CSV export
// (M3-T4 AC-8): a submission whose order exists but whose denormalized
// ticketLabel is null (edge case — finalize normally stamps it) falls back to
// a bounded join via orderId, so the Ticket cell is never broken. Legacy flat
// submissions have no orderId at all and correctly render "—".
import "server-only";

import { getAdminOrderForEvent } from "@/lib/db/adminOrder";
import type { FormDataDoc, WithId } from "@/types/collection";

// Bounded work per request: rows needing the fallback are rare (finalize
// denormalizes the label), so a small cap keeps list/export reads cheap.
const TICKET_LABEL_JOIN_LIMIT = 20;

export async function resolveResponseTicketLabels(
  responses: WithId<FormDataDoc>[],
  organizationId: string,
): Promise<Map<string, string | null>> {
  const labels = new Map<string, string | null>();

  const needingJoin = responses
    .filter(
      (response) =>
        (response.ticketLabel ?? null) === null &&
        typeof response.orderId === "string" &&
        response.orderId.length > 0,
    )
    .slice(0, TICKET_LABEL_JOIN_LIMIT);

  await Promise.all(
    needingJoin.map(async (response) => {
      try {
        const order = await getAdminOrderForEvent({
          orderId: response.orderId as string,
          eventId: response.eventId,
          organizationId,
        });
        // The order snapshot's feeName is what finalize denormalizes the
        // label from — same source, same value.
        labels.set(response.id, order?.snapshot.feeName ?? null);
      } catch {
        // A failed join degrades to the muted "—" cell — never a broken row.
        labels.set(response.id, null);
      }
    }),
  );

  return labels;
}
