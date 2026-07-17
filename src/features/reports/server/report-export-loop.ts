// Shared CSV-export accumulation loop (spec D2, agents/docs/specs/
// m7-report-templates.md): loops a cursor-paginated DAL list method at a
// larger internal batch size than Run's page-50 UX, accumulating rows until
// EITHER REPORT_EXPORT_ROW_LIMIT is reached OR the underlying query is
// exhausted (page.length < batchSize) — whichever comes first. Reused
// verbatim by every template whose underlying query already returns ONLY
// rows that belong in the report (Registration overview, Order &
// transaction details, Badges printed / check-in history, Email overview).
//
// Abandoned registration details does NOT use this helper — its export loop
// needs a SECOND, independent ceiling (raw-page-fetch count) because
// isAbandoned is filtered in memory per page, not by the Firestore query
// itself (spec §3's documented wrinkle) — see load-abandoned-registrations.ts.
import "server-only";

// Internal batch size for export loops — larger than Run's page-50 UX
// (invisible to the client, fewer round-trips for a background export
// computation), per spec D2.
export const REPORT_EXPORT_BATCH_SIZE = 200;

export async function collectExportDocs<Doc>(input: {
  rowLimit: number;
  batchSize?: number;
  fetchPage: (cursorMs: number | undefined) => Promise<Doc[]>;
  cursorMsOf: (doc: Doc) => number | null;
}): Promise<Doc[]> {
  const batchSize = input.batchSize ?? REPORT_EXPORT_BATCH_SIZE;
  const collected: Doc[] = [];
  let cursorMs: number | undefined;

  while (collected.length < input.rowLimit) {
    const page = await input.fetchPage(cursorMs);
    if (page.length === 0) break;

    const remaining = input.rowLimit - collected.length;
    collected.push(...page.slice(0, remaining));

    if (page.length < batchSize) break; // query exhausted

    const cursorSource = page[page.length - 1];
    const nextCursorMs = input.cursorMsOf(cursorSource);
    if (nextCursorMs === null) break;
    cursorMs = nextCursorMs;
  }

  return collected;
}
