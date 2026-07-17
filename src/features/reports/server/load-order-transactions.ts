// Server-side loader for the "Order & transaction details" report template.
// Spec §2 (agents/docs/specs/m7-report-templates.md): the first UI surface
// ever to render individual Order docs (flagged for Security, D1). Includes
// pending/failed orders too (unlike M7-T1's finance card) — a transaction
// audit report's job is completeness. Data source: getAdminOrdersForEvent
// (src/lib/db/adminOrder.ts), extended by Backend (M7-T2) with
// startAfterCreatedAtMs — see agents/docs/data-models/m7-report-templates.md
// §1 for the exact shipped signature this loader is written against.
import "server-only";

import { ORDER_LIST_LIMIT, getAdminOrdersForEvent } from "@/lib/db/adminOrder";
import { timestampToIso, timestampToMs } from "@/features/attendees/roster";
import { REPORT_EXPORT_ROW_LIMIT } from "@/features/reports/csv";
import { collectExportDocs } from "@/features/reports/server/report-export-loop";
import {
  TYPE_NAME_FALLBACK,
  loadTypeNameMaps,
  type TypeNameMaps,
} from "@/features/reports/server/resolve-type-names";
import { formatMoney } from "@/features/pricing/utils";
import type { ReportPage, ReportRow } from "@/features/reports/types";
import type { OrderDoc, WithId } from "@/types/collection";

const RUN_PAGE_SIZE = ORDER_LIST_LIMIT;

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function serializeRow(doc: WithId<OrderDoc>, names: TypeNameMaps): ReportRow {
  return {
    orderId: doc.id,
    submissionId: doc.submissionId ?? "",
    ticketType:
      names.ticketTypeNames.get(doc.ticketTypeId) ?? TYPE_NAME_FALLBACK,
    registrationType:
      names.registrationTypeNames.get(doc.registrationTypeId) ??
      TYPE_NAME_FALLBACK,
    // Frozen at purchase — never re-joins to the live Fee doc (spec §2,
    // audit-trail correctness, same principle as every other snapshot.* field).
    feeName: doc.snapshot.feeName,
    currency: doc.currency,
    subtotal: formatMoney(doc.amounts.subtotalMinor, doc.currency),
    discount: formatMoney(doc.amounts.discountMinor, doc.currency),
    tax: formatMoney(doc.amounts.taxMinor, doc.currency),
    total: formatMoney(doc.amounts.totalMinor, doc.currency),
    promoCode: doc.snapshot.promoCode ?? "",
    paymentMethod: capitalize(doc.paymentMethod),
    paymentStatus: capitalize(doc.paymentStatus),
    providerPaymentId: doc.providerPaymentId ?? "",
    createdAt: timestampToIso(doc.createdAt) ?? "",
  };
}

export async function loadOrderTransactionsPage(input: {
  eventId: string;
  organizationId: string;
  cursorMs?: number;
}): Promise<ReportPage> {
  const [docs, names] = await Promise.all([
    getAdminOrdersForEvent({
      eventId: input.eventId,
      organizationId: input.organizationId,
      limit: RUN_PAGE_SIZE,
      startAfterCreatedAtMs: input.cursorMs,
    }),
    loadTypeNameMaps({
      eventId: input.eventId,
      organizationId: input.organizationId,
    }),
  ]);

  const last = docs[docs.length - 1];
  return {
    rows: docs.map((doc) => serializeRow(doc, names)),
    nextCursorMs: last ? timestampToMs(last.createdAt) : null,
    hasMore: docs.length === RUN_PAGE_SIZE,
  };
}

export async function loadOrderTransactionsExport(input: {
  eventId: string;
  organizationId: string;
}): Promise<ReportRow[]> {
  const names = await loadTypeNameMaps({
    eventId: input.eventId,
    organizationId: input.organizationId,
  });

  const docs = await collectExportDocs<WithId<OrderDoc>>({
    rowLimit: REPORT_EXPORT_ROW_LIMIT,
    fetchPage: (cursorMs) =>
      getAdminOrdersForEvent({
        eventId: input.eventId,
        organizationId: input.organizationId,
        limit: 200,
        startAfterCreatedAtMs: cursorMs,
      }),
    cursorMsOf: (doc) => timestampToMs(doc.createdAt),
  });

  return docs.map((doc) => serializeRow(doc, names));
}
