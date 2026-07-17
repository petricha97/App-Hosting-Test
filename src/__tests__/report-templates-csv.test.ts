/**
 * M7-T2 — Report templates catalog + CSV mechanics.
 * Spec: agents/docs/specs/m7-report-templates.md D6, §7, §8, D4.
 */
import { describe, expect, it } from "vitest";

import {
  buildReportCsv,
  REPORT_EXPORT_ROW_LIMIT,
} from "@/features/reports/csv";
import {
  REPORT_TEMPLATES,
  getReportTemplate,
} from "@/features/reports/templates";

describe("REPORT_TEMPLATES catalog (D6)", () => {
  it("has exactly 5 entries with the documented slugs and categories", () => {
    expect(REPORT_TEMPLATES.map((t) => t.slug)).toEqual([
      "registration-overview",
      "order-transactions",
      "abandoned-registrations",
      "checkin-history",
      "email-overview",
    ]);
    expect(REPORT_TEMPLATES.map((t) => t.category)).toEqual([
      "Attendee",
      "Finance",
      "Attendee",
      "Onsite",
      "Email",
    ]);
  });

  it("each template's column headers are in the exact spec order (§1–§5)", () => {
    expect(
      getReportTemplate("registration-overview")?.columns.map((c) => c.header),
    ).toEqual([
      "Name",
      "Email",
      "Company",
      "Job title",
      "Registration type",
      "Ticket type",
      "Status",
      "Check-in state",
      "Checked-in at",
      "Registered at",
    ]);

    expect(
      getReportTemplate("order-transactions")?.columns.map((c) => c.header),
    ).toEqual([
      "Order ID",
      "Submission ID",
      "Ticket type",
      "Registration type",
      "Fee name",
      "Currency",
      "Subtotal",
      "Discount",
      "Tax",
      "Total",
      "Promo code",
      "Payment method",
      "Payment status",
      "Provider payment ID",
      "Created at",
    ]);

    expect(
      getReportTemplate("abandoned-registrations")?.columns.map(
        (c) => c.header,
      ),
    ).toEqual([
      "Name",
      "Email (masked)",
      "Last step reached",
      "Ticket type selected",
      "Registration type selected",
      "Last activity",
    ]);

    expect(
      getReportTemplate("checkin-history")?.columns.map((c) => c.header),
    ).toEqual([
      "Name",
      "Email",
      "Registration type",
      "Ticket type",
      "Check-in state",
      "Checked-in at",
      "Checked-in by",
    ]);

    expect(
      getReportTemplate("email-overview")?.columns.map((c) => c.header),
    ).toEqual([
      "Recipient name",
      "Recipient email",
      "Email",
      "Subject",
      "Status",
      "Attempt count",
      "Last error",
      "Queued at",
      "Sent at",
      "Failed at",
    ]);
  });

  it("Email overview never includes bodyHtml/bodyText as columns (spec §5 AC-4)", () => {
    const keys = getReportTemplate("email-overview")?.columns.map((c) => c.key);
    expect(keys).not.toContain("bodyHtml");
    expect(keys).not.toContain("bodyText");
  });

  it("Abandoned has no empty-state CTA; every other template does", () => {
    expect(
      getReportTemplate("abandoned-registrations")?.emptyState.ctaLabel,
    ).toBeUndefined();
    expect(
      getReportTemplate("registration-overview")?.emptyState.ctaLabel,
    ).toBe("Go to Attendees");
  });
});

describe("buildReportCsv (spec §7)", () => {
  const columns = getReportTemplate("registration-overview")!.columns;

  it("emits CRLF line endings and the exact header row", () => {
    const csv = buildReportCsv(columns, [
      {
        name: "Ada Lovelace",
        email: "ada@example.com",
        company: "Acme",
        jobTitle: "Engineer",
        registrationType: "Delegate",
        ticketType: "General",
        status: "Accepted",
        checkInState: "Checked in",
        checkedInAt: "2026-01-01T00:00:00.000Z",
        registeredAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const [header, row] = csv.split("\r\n");
    expect(header).toBe(
      "Name,Email,Company,Job title,Registration type,Ticket type,Status,Check-in state,Checked-in at,Registered at",
    );
    expect(row).toContain("Ada Lovelace");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("applies formula-injection escaping + RFC-4180 quoting (§7 AC-3)", () => {
    const csv = buildReportCsv(columns, [
      {
        name: "Ada Lovelace",
        email: "ada@example.com",
        company: '=SUM(A1),"weird"',
        jobTitle: "",
        registrationType: "",
        ticketType: "",
        status: "Accepted",
        checkInState: "Not arrived",
        checkedInAt: "",
        registeredAt: "",
      },
    ]);

    expect(csv).toContain("'=SUM(A1)");
    // The comma+quote inside the field forces RFC-4180 quoting.
    expect(csv).toContain('"\'=SUM(A1),""weird"""');
  });

  it("REPORT_EXPORT_ROW_LIMIT is 1000, shared by every template", () => {
    expect(REPORT_EXPORT_ROW_LIMIT).toBe(1000);
  });
});
