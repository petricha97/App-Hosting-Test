// @vitest-environment node
/**
 * QA regression suite — M7-T2 Report templates library.
 * Independent re-verification (per QA's own ticket instructions, not a copy
 * of Backend's fixtures) of:
 *  1. Hand-computed column correctness for Registration overview and Order &
 *     transaction details, with fresh, distinctive fixture values.
 *  2. D4's masked-email rule verified against the ACTUAL CSV file bytes
 *     produced by buildReportCsv() — not just the JSON row (Code
 *     Review/Security's tests only ever asserted on JSON.stringify(rows)).
 *  3. CSV escaping/formula-injection correctness verified by round-tripping
 *     buildReportCsv()'s real output through a real (if minimal), quote-aware
 *     RFC-4180 parser — not a string-containment check (Code Review's own
 *     N-1 nit: the existing suite never does this for any of the 5
 *     templates; spec §7 AC-3 explicitly asks for a "real CSV parser").
 *  4. Order & transaction details — explicit regression test asserting
 *     idempotencyKey/paymentProvider never reach the Run row, the export
 *     row, or the built CSV bytes (Security finding L-1: this exact
 *     assertion did not previously exist as an automated test).
 *
 * Spec: agents/docs/specs/m7-report-templates.md §1, §2, §3, §7, D4.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

const { loadRegistrationOverviewPage } = await import(
  "@/features/reports/server/load-registration-overview"
);
const { loadOrderTransactionsPage, loadOrderTransactionsExport } =
  await import("@/features/reports/server/load-order-transactions");
const { loadAbandonedRegistrationsExport } = await import(
  "@/features/reports/server/load-abandoned-registrations"
);
const { buildReportCsv } = await import("@/features/reports/csv");
const { getReportTemplate } = await import("@/features/reports/templates");

const ORG_ID = "org-qa-1";
const EVENT_ID = "evt-qa-1";

// ---------------------------------------------------------------------------
// A minimal, but genuinely quote-aware, RFC-4180 parser — walks the raw CSV
// string char-by-char honoring the quoted-field state machine (comma/CRLF
// inside a quoted field do NOT split fields/rows; "" inside a quoted field
// is a literal doubled quote). This is what QA is asked to verify against —
// not a string .includes() check.
// ---------------------------------------------------------------------------
function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < raw.length) {
    const char = raw[i];

    if (inQuotes) {
      if (char === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r" && raw[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 2;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  // Trailing partial row (buildReportCsv always ends with \r\n, so this is
  // normally empty — guard anyway so a malformed trailing fragment isn't lost).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

beforeEach(() => {
  fake.reset();
});

// ===========================================================================
// 1. Hand-computed column correctness — Registration overview
// ===========================================================================

describe("QA — Registration overview: hand-computed column fixture (spec §1)", () => {
  it("every column matches its spec-defined source field for a fresh, distinctive fixture", async () => {
    fake.store.set("Attendee/qa-att-1", {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: "sub-qa-1",
      orderId: null,
      pathId: null,
      firstName: "Zora",
      lastName: "Quilombo",
      email: "zora.quilombo+qa@example.net",
      company: "Quilombo Robotics",
      jobTitle: "Principal Firmware Engineer",
      registrationTypeId: "rt-qa",
      registrationTypeLabel: "VIP Delegate",
      ticketTypeId: "tt-qa",
      ticketLabel: "All-Access Pass",
      status: "accepted",
      checkInState: "checked-in",
      checkedInAt: { seconds: 1_700_000_500, toDate: () => new Date(1_700_000_500_000) },
      checkedInBy: { kind: "admin", userId: "organizer@example.com" },
      qrTokenHash: "hash-qa",
      createdAt: { seconds: 1_700_000_000, toDate: () => new Date(1_700_000_000_000) },
      updatedAt: { seconds: 1_700_000_000, toDate: () => new Date(1_700_000_000_000) },
    });

    const page = await loadRegistrationOverviewPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows).toHaveLength(1);
    // Hand-computed expectation, independently derived from spec §1's column
    // table — not copied from any Backend fixture.
    expect(page.rows[0]).toEqual({
      name: "Zora Quilombo",
      email: "zora.quilombo+qa@example.net",
      company: "Quilombo Robotics",
      jobTitle: "Principal Firmware Engineer",
      registrationType: "VIP Delegate",
      ticketType: "All-Access Pass",
      status: "Accepted",
      checkInState: "Checked in",
      checkedInAt: new Date(1_700_000_500_000).toISOString(),
      registeredAt: new Date(1_700_000_000_000).toISOString(),
    });
  });
});

// ===========================================================================
// 1b. Hand-computed column correctness — Order & transaction details
// ===========================================================================

describe("QA — Order & transaction details: hand-computed column fixture (spec §2)", () => {
  beforeEach(() => {
    fake.store.set("TicketType/tt-qa", {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "Executive Pass",
      code: "TT-QA",
      capacity: null,
      registeredCount: 0,
      salesStart: null,
      salesEnd: null,
      isOpen: true,
      registrationTypeIds: [],
      createdAt: { seconds: 0 },
      updatedAt: { seconds: 0 },
    });
    fake.store.set("RegistrationType/rt-qa", {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      name: "Corporate Sponsor",
      code: "RT-QA",
      capacity: null,
      registeredCount: 0,
      createdAt: { seconds: 0 },
      updatedAt: { seconds: 0 },
    });
  });

  it("money columns match hand-computed formatMoney output, not recomputed pricing", async () => {
    fake.store.set("Order/qa-ord-1", {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: "sub-qa-ord-1",
      ticketTypeId: "tt-qa",
      registrationTypeId: "rt-qa",
      feeId: "fee-qa",
      promotionId: "promo-qa",
      taxIds: ["tax-qa"],
      currency: "USD",
      amounts: {
        subtotalMinor: 123_456, // $1,234.56
        discountMinor: 4_321, // $43.21
        taxMinor: 9_999, // $99.99
        totalMinor: 129_134, // $1,291.34
      },
      snapshot: {
        feeName: "Founders Circle Fee",
        basePriceMinor: 123_456,
        promoCode: "QAFOUNDERS25",
        discountType: "fixed",
        discountValue: 4_321,
        taxLines: [],
      },
      paymentMethod: "invoice",
      paymentStatus: "outstanding",
      paymentProvider: "simulated",
      providerPaymentId: "pi_qa_distinctive_998877",
      idempotencyKey: "idem-qa-distinctive-998877",
      createdAt: { seconds: 1_700_100_000, toDate: () => new Date(1_700_100_000_000) },
      updatedAt: { seconds: 1_700_100_000, toDate: () => new Date(1_700_100_000_000) },
    });

    const page = await loadOrderTransactionsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toEqual({
      orderId: "qa-ord-1",
      submissionId: "sub-qa-ord-1",
      ticketType: "Executive Pass",
      registrationType: "Corporate Sponsor",
      feeName: "Founders Circle Fee",
      currency: "USD",
      subtotal: "$1,234.56",
      discount: "$43.21",
      tax: "$99.99",
      total: "$1,291.34",
      promoCode: "QAFOUNDERS25",
      paymentMethod: "Invoice",
      paymentStatus: "Outstanding",
      providerPaymentId: "pi_qa_distinctive_998877",
      createdAt: new Date(1_700_100_000_000).toISOString(),
    });
  });

  // ---------------------------------------------------------------------
  // 4. Explicit regression test for Security finding L-1: no internal-only
  //    OrderDoc field (idempotencyKey, paymentProvider) reaches the Run row,
  //    the export row, or the built CSV bytes.
  // ---------------------------------------------------------------------
  it("REGRESSION (Security L-1): idempotencyKey/paymentProvider never leak into the Run row, export row, or CSV bytes", async () => {
    const SECRET_IDEMPOTENCY_KEY = "QA-SECRET-IDEMPOTENCY-77441122";

    fake.store.set("Order/qa-ord-secret", {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      submissionId: "sub-secret",
      ticketTypeId: "tt-qa",
      registrationTypeId: "rt-qa",
      feeId: "fee-qa",
      promotionId: "promo-qa",
      taxIds: ["tax-qa"],
      currency: "USD",
      amounts: {
        subtotalMinor: 1000,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 1000,
      },
      snapshot: {
        feeName: "Standard",
        basePriceMinor: 1000,
        promoCode: null,
        discountType: null,
        discountValue: null,
        taxLines: [],
      },
      paymentMethod: "card",
      paymentStatus: "paid",
      paymentProvider: "simulated",
      providerPaymentId: "pi_visible_ok",
      idempotencyKey: SECRET_IDEMPOTENCY_KEY,
      createdAt: { seconds: 1, toDate: () => new Date(1000) },
      updatedAt: { seconds: 1, toDate: () => new Date(1000) },
    });

    const page = await loadOrderTransactionsPage({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });
    const exportRows = await loadOrderTransactionsExport({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
    });

    // Row-shape assertion: neither internal-only key is ever present.
    expect(Object.keys(page.rows[0])).not.toContain("idempotencyKey");
    expect(Object.keys(page.rows[0])).not.toContain("paymentProvider");
    expect(Object.keys(exportRows[0])).not.toContain("idempotencyKey");
    expect(Object.keys(exportRows[0])).not.toContain("paymentProvider");

    // Value-leak assertion: the secret idempotency key string itself never
    // appears anywhere in the serialized Run row, export row, or CSV bytes
    // (guards against a future refactor swapping the explicit field list for
    // an object spread that would silently reintroduce the leak).
    expect(JSON.stringify(page.rows)).not.toContain(SECRET_IDEMPOTENCY_KEY);
    expect(JSON.stringify(exportRows)).not.toContain(SECRET_IDEMPOTENCY_KEY);

    const columns = getReportTemplate("order-transactions")!.columns;
    const csv = buildReportCsv(columns, exportRows);
    expect(csv).not.toContain(SECRET_IDEMPOTENCY_KEY);
    expect(csv).not.toContain("paymentProvider");
    expect(csv).not.toContain("idempotencyKey");
    // The order ID (SHA-256 hash of the idempotency key, per spec §2) IS
    // expected to appear — that's the intended, reviewed, non-reversible
    // reference column, not a leak.
    expect(csv).toContain("qa-ord-secret");
  });
});

// ===========================================================================
// 2. D4 masked-email rule verified against the ACTUAL CSV FILE BYTES
// ===========================================================================

describe("QA — D4 masked email: verified in the real CSV artifact, not just JSON", () => {
  it("the raw local-part never appears anywhere in the built CSV string", async () => {
    const DISTINCTIVE_LOCAL_PART = "zzqqxx-qa-distinctive-7743";
    fake.store.set("RegistrationDraft/qa-draft-1", {
      organizationId: ORG_ID,
      eventId: EVENT_ID,
      pathId: "path-1",
      formId: "form-1",
      draftTokenHash: "hash",
      lastStepReached: "payment",
      stepAnswers: {},
      ticketTypeId: null,
      registrationTypeId: null,
      promotionId: null,
      attempt: 1,
      firstName: "Priya",
      lastName: "Okafor",
      email: `${DISTINCTIVE_LOCAL_PART}@qacorp.example`,
      createdAt: {
        seconds: 0,
        toMillis: () => 0,
        toDate: () => new Date(0),
      },
      updatedAt: {
        seconds: 0,
        toMillis: () => 0,
        toDate: () => new Date(0),
      },
    });

    const rows = await loadAbandonedRegistrationsExport({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      nowMs: 48 * 60 * 60 * 1000, // 48h later — well past the 24h threshold
    });

    const columns = getReportTemplate("abandoned-registrations")!.columns;
    const csv = buildReportCsv(columns, rows);

    // The literal raw local-part must be absent from the actual file bytes —
    // D4's core security property (masking) genuinely holds.
    expect(csv).not.toContain(DISTINCTIVE_LOCAL_PART);
    expect(csv).not.toContain(`${DISTINCTIVE_LOCAL_PART}@qacorp.example`);
    expect(csv).toContain("qacorp.example");

    // Round-trip through the real parser to see the EXACT cell value a
    // downstream consumer receives.
    const parsed = parseCsv(csv);
    const header = parsed[0];
    const emailColIndex = header.indexOf("Email (masked)");
    expect(emailColIndex).toBeGreaterThanOrEqual(0);

    // DEFECT (QA-1, Minor — see agents/docs/qa/m7-report-templates.md):
    // maskEmailDomain() always returns a value starting with the literal
    // "@" character. escapeCsvField()'s formula-injection guard
    // (FORMULA_PREFIX = /^\s*[=+\-@]/, src/features/responses/csv.ts)
    // treats a leading "@" as a formula-injection risk and prepends a
    // guard apostrophe — so EVERY masked-email cell in the raw CSV bytes
    // is actually "'@domain.com", not the literal "@domain.com" the
    // design doc's own example shows (agents/docs/design/
    // m7-report-templates.md §4: 'e.g. "@example.com"'). This does not
    // reopen the D4 security hole (the local part is still never present,
    // and Excel/Sheets — the guard's actual target — hide the leading
    // apostrophe from the rendered cell), but it is a real, 100%-of-rows
    // deviation from the documented raw-file format for this template
    // specifically (unlike the guard firing on adversarial/rare user input
    // elsewhere, this fires on the report's OWN generated value, every
    // time). Asserting the VERIFIED actual value here (not the originally
    // assumed one) so this doesn't silently regress further un-reviewed.
    expect(parsed[1][emailColIndex]).toBe("'@qacorp.example");
  });
});

// ===========================================================================
// 3. CSV escaping / formula-injection round-trip via a REAL parser
// ===========================================================================

describe("QA — CSV escaping round-trips correctly through a real RFC-4180 parser (spec §7 AC-3)", () => {
  it("a fixture with leading '=', embedded comma, embedded quote, and embedded newline (one column each) parses back to the original semantic values", () => {
    const columns = getReportTemplate("registration-overview")!.columns;

    const FORMULA_VALUE = "=CMD|'/C calc'!A0";
    const COMMA_VALUE = "Acme, Inc. — Global Events, Ltd.";
    const QUOTE_VALUE = 'The "Grand" Ballroom';
    const NEWLINE_VALUE = "Line one\nLine two\nLine three";

    const csv = buildReportCsv(columns, [
      {
        name: "Formula Case",
        email: FORMULA_VALUE, // leading '=' — formula-injection guard
        company: COMMA_VALUE, // embedded comma — RFC-4180 quoting
        jobTitle: QUOTE_VALUE, // embedded double-quote — doubled + quoted
        registrationType: NEWLINE_VALUE, // embedded newline — quoted, no row split
        ticketType: "General",
        status: "Accepted",
        checkInState: "Checked in",
        checkedInAt: "",
        registeredAt: "",
      },
    ]);

    const parsed = parseCsv(csv);

    // Exactly 2 rows (header + the one data row) — an embedded raw newline
    // inside a quoted field must NOT be misread as a new CSV row by a real,
    // quote-aware parser.
    expect(parsed).toHaveLength(2);

    const header = parsed[0];
    const dataRow = parsed[1];
    const cell = (colHeader: string) => dataRow[header.indexOf(colHeader)];

    // Formula-injection guard: neutralized with a leading apostrophe (so a
    // spreadsheet renders/treats it as inert text), and the round-tripped
    // value is exactly the guarded, non-executable string — never the bare
    // formula string a naive implementation might leave unescaped.
    expect(cell("Email")).toBe(`'${FORMULA_VALUE}`);
    expect(cell("Email").startsWith("=")).toBe(false);

    // RFC-4180 quoting: the comma, the quote, and the newline all round-trip
    // to their EXACT original values — not truncated, not split across
    // fields/rows, not left with stray unescaped quotes.
    expect(cell("Company")).toBe(COMMA_VALUE);
    expect(cell("Job title")).toBe(QUOTE_VALUE);
    expect(cell("Registration type")).toBe(NEWLINE_VALUE);

    // Sanity: the field count on the data row still matches the header
    // (proves the comma inside "Company" didn't spuriously split the row
    // into extra fields).
    expect(dataRow).toHaveLength(header.length);
  });
});
