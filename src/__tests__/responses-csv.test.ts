/**
 * M3-T4 — CSV export builder (src/features/responses/csv.ts).
 * Spec: agents/docs/specs/m3-registration-paths.md (T4 AC-6).
 *
 * Locks the escaping contract: formula-injection guard (leading = + - @,
 * including behind leading whitespace/tab/CR, prefixed with ') applied
 * BEFORE RFC-4180 quoting (commas / quotes / CR /
 * LF), the fixed header set, the sorted answer-key union (identity keys
 * excluded), and CRLF line endings.
 */
import { describe, expect, it } from "vitest";

import {
  RESPONSES_EXPORT_LIMIT,
  buildResponsesCsv,
  collectAnswerKeys,
  escapeCsvField,
  toResponsesCsvRow,
  type ResponsesCsvRow,
} from "@/features/responses/csv";
import type { SerializedResponse } from "@/features/responses/utils";

describe("escapeCsvField — formula injection (OWASP CSV injection)", () => {
  it.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+123", "'+123"],
    ["-cmd", "'-cmd"],
    ["@import", "'@import"],
  ])("prefixes %s with a quote", (input, expected) => {
    expect(escapeCsvField(input)).toBe(expected);
  });

  it.each([
    [" =SUM(A1:A9)", "' =SUM(A1:A9)"],
    ["\t=cmd()", "'\t=cmd()"],
    ["  +123", "'  +123"],
  ])(
    "guards a formula char behind leading whitespace/tab (%j — security L-2)",
    (input, expected) => {
      expect(escapeCsvField(input)).toBe(expected);
    },
  );

  it("guards a formula char behind a leading CR and still RFC-quotes it", () => {
    // CR triggers both rules: quote-prefix first, then RFC-4180 wrapping.
    expect(escapeCsvField("\r=1+1")).toBe("\"'\r=1+1\"");
  });

  it("leaves benign values untouched", () => {
    expect(escapeCsvField("Ada Lovelace")).toBe("Ada Lovelace");
    expect(escapeCsvField("a=b")).toBe("a=b"); // = not at position 0
    expect(escapeCsvField(" leading space")).toBe(" leading space");
    expect(escapeCsvField("")).toBe("");
  });
});

describe("escapeCsvField — RFC 4180 quoting", () => {
  it("quotes fields containing commas", () => {
    expect(escapeCsvField("Lovelace, Ada")).toBe('"Lovelace, Ada"');
  });

  it("doubles inner quotes and wraps", () => {
    expect(escapeCsvField('the "best" event')).toBe('"the ""best"" event"');
  });

  it("quotes fields containing newlines (LF and CR)", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\rline2")).toBe('"line1\rline2"');
  });

  it("applies BOTH rules to a formula containing a comma", () => {
    expect(escapeCsvField("=1,2")).toBe("\"'=1,2\"");
  });
});

function makeRow(overrides: Partial<ResponsesCsvRow> = {}): ResponsesCsvRow {
  return {
    name: "Ada Lovelace",
    email: "ada@example.com",
    eventName: "GovTech Conference",
    ticketLabel: "GC Early Bird",
    status: "new",
    submittedAtIso: "2026-07-01T10:00:00.000Z",
    submission: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
    ...overrides,
  };
}

describe("buildResponsesCsv", () => {
  it("emits the fixed header plus the sorted union of answer keys (identity keys excluded)", () => {
    const csv = buildResponsesCsv([
      makeRow({ submission: { first_name: "A", email: "a@x.com", z_field: "1", company: "Acme" } }),
      makeRow({ submission: { last_name: "B", dietary: "vegan" } }),
    ]);

    const [header] = csv.split("\r\n");
    expect(header).toBe("Name,Email,Event,Ticket,Status,Submitted,company,dietary,z_field");
  });

  it("renders one line per row with empty cells for missing answers and null tickets", () => {
    const csv = buildResponsesCsv([
      makeRow({
        ticketLabel: null,
        submittedAtIso: null,
        submission: { dietary: "halal" },
      }),
    ]);

    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(
      "Ada Lovelace,ada@example.com,GovTech Conference,,new,,halal",
    );
  });

  it("escapes malicious submission answers end-to-end", () => {
    const csv = buildResponsesCsv([
      makeRow({ name: "=HYPERLINK(evil)", submission: { note: "hi, there" } }),
    ]);

    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("'=HYPERLINK(evil)");
    expect(lines[1]).toContain('"hi, there"');
  });

  it("uses CRLF endings and a trailing newline", () => {
    const csv = buildResponsesCsv([makeRow()]);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3); // header + row + trailing ""
  });

  it("collectAnswerKeys never includes identity keys", () => {
    expect(
      collectAnswerKeys([
        makeRow({ submission: { first_name: "A", last_name: "B", email: "e", other: "x" } }),
      ]),
    ).toEqual(["other"]);
  });
});

describe("toResponsesCsvRow", () => {
  it("maps the table serializer's shape so CSV rows match on-screen rows", () => {
    const serialized: SerializedResponse = {
      id: "fd-1",
      formId: "form-1",
      eventId: "evt-1",
      organizationId: "org-1",
      submission: { first_name: "Ada", email: "ada@example.com", note: "hi" },
      submittedAt: { seconds: 100, nanoseconds: 0, isoString: "2026-07-01T10:00:00.000Z" },
      attendeeName: "Ada",
      attendeeEmail: "ada@example.com",
      eventName: "GovTech",
      submissionPreview: [],
      status: "pending",
      ticketLabel: "GC Standard",
      orderId: "order-1",
    };

    expect(toResponsesCsvRow(serialized)).toEqual({
      name: "Ada",
      email: "ada@example.com",
      eventName: "GovTech",
      ticketLabel: "GC Standard",
      status: "pending",
      submittedAtIso: "2026-07-01T10:00:00.000Z",
      submission: { first_name: "Ada", email: "ada@example.com", note: "hi" },
    });
  });

  it("export cap is 1000 rows (documented bound)", () => {
    expect(RESPONSES_EXPORT_LIMIT).toBe(1000);
  });
});
