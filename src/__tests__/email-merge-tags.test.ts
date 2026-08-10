// @vitest-environment node
/**
 * M6-T1 — merge-tag renderer + catalog (src/lib/email/merge-tags.ts) and the
 * doc -> context mapping (src/lib/email/merge-context.ts).
 * Spec: agents/docs/specs/m6-email-infrastructure.md (§3 AC 1-6).
 *
 * Locks:
 *  - every catalog tag renders from its documented source (context builder)
 *  - HTML-escaping in bodyHtml, verbatim bodyText (XSS)
 *  - CR/LF + control chars stripped from values merged into subject
 *    (header injection)
 *  - missing -> "" + missingTags; unknown -> literal + unknownTags
 *  - {qr_code} = trusted markup, HTML body ONLY; raw token appears nowhere
 *  - purity edges: empty template, only-tags, repeated, adjacent, "{}",
 *    "{unclosed"
 */
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";

import {
  buildEmailMergeContext,
  formatOrderTotal,
  PAYMENT_STATUS_LABELS,
  publicEventUrl,
} from "@/lib/email/merge-context";
import {
  EMAIL_MERGE_TAGS,
  renderEmailTemplate,
  type EmailMergeContext,
} from "@/lib/email/merge-tags";
import { mintQrToken, verifyQrToken } from "@/lib/qr/qr-token";

const QR_SECRET = "test-qr-secret";

const FULL_CONTEXT: EmailMergeContext = {
  eventTitle: "Innovation@50x Summit",
  eventDate: "2026-09-01, 09:00 – 17:00 · Europe/London",
  firstName: "Kenneth",
  lastName: "Cha",
  email: "kenneth@example.com",
  company: "The Economist",
  jobTitle: "Editor",
  ticketName: "Complimentary delegate",
  registrationType: "Delegate",
  orderTotal: "$1,299.00",
  paymentStatus: "Paid",
  qrCodeSvg: '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>',
  eventUrl: "/events/evt-1",
};

describe("renderEmailTemplate — catalog rendering (AC-1)", () => {
  it("renders a confirmation-style template into the prototype preview shape", () => {
    const result = renderEmailTemplate(
      {
        subject: "Your pass for {event_title}",
        bodyHtml:
          "<p>Dear {first_name},</p>" +
          "<p>Your pass: <strong>{ticket_name}</strong></p>" +
          "<p>{event_date} — {event_url}</p>" +
          "{qr_code}",
        bodyText:
          "Dear {full_name}, your pass: {ticket_name}. " +
          "Total {order_total} ({payment_status}).",
      },
      FULL_CONTEXT,
    );

    expect(result.subject).toBe("Your pass for Innovation@50x Summit");
    expect(result.bodyHtml).toContain("<p>Dear Kenneth,</p>");
    expect(result.bodyHtml).toContain(
      "<p>Your pass: <strong>Complimentary delegate</strong></p>",
    );
    expect(result.bodyHtml).toContain(
      "2026-09-01, 09:00 – 17:00 · Europe/London — /events/evt-1",
    );
    expect(result.bodyHtml).toContain(FULL_CONTEXT.qrCodeSvg);
    expect(result.bodyText).toBe(
      "Dear Kenneth Cha, your pass: Complimentary delegate. " +
        "Total $1,299.00 (Paid).",
    );
    expect(result.missingTags).toEqual([]);
    expect(result.unknownTags).toEqual([]);
    expect(result.unknownVariables).toEqual([]);
    expect(result.usedTags).toEqual(
      expect.arrayContaining([
        "event_title",
        "first_name",
        "full_name",
        "ticket_name",
        "event_date",
        "event_url",
        "order_total",
        "payment_status",
        "qr_code",
      ]),
    );
  });

  it("renders every tag in the canonical catalog without throwing", () => {
    const template = EMAIL_MERGE_TAGS.map((tag) => `{${tag}}`).join(" ");
    const result = renderEmailTemplate(
      { subject: template, bodyHtml: template, bodyText: template },
      FULL_CONTEXT,
    );

    expect(result.usedTags).toHaveLength(EMAIL_MERGE_TAGS.length);
    expect(result.missingTags).toEqual([]);
    expect(result.unknownTags).toEqual([]);
    expect(result.unknownVariables).toEqual([]);
    // No unreplaced known tag survives anywhere.
    for (const tag of EMAIL_MERGE_TAGS) {
      expect(result.bodyHtml).not.toContain(`{${tag}}`);
      expect(result.bodyText).not.toContain(`{${tag}}`);
      expect(result.subject).not.toContain(`{${tag}}`);
    }
  });
});

describe("renderEmailTemplate — injection safety (AC-2/AC-3, SEC)", () => {
  it("HTML-escapes registrant-supplied values in bodyHtml, verbatim in bodyText", () => {
    const context: EmailMergeContext = {
      firstName: "<script>alert(1)</script>",
    };
    const result = renderEmailTemplate(
      {
        subject: "",
        bodyHtml: "<p>Hi {first_name}</p>",
        bodyText: "Hi {first_name}",
      },
      context,
    );

    expect(result.bodyHtml).toBe(
      "<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
    expect(result.bodyHtml).not.toContain("<script>");
    expect(result.bodyText).toBe("Hi <script>alert(1)</script>");
  });

  it("strips CR/LF and control characters from values merged into subject", () => {
    const result = renderEmailTemplate(
      { subject: "Hello {first_name}", bodyHtml: "", bodyText: "" },
      { firstName: "Ken\r\nBcc: attacker@x.com" },
    );

    expect(result.subject).toBe("Hello KenBcc: attacker@x.com");
    expect(result.subject).not.toMatch(/[\r\n\u0000-\u001f]/);
  });
});

describe("renderEmailTemplate — missing & unknown tags (AC-4)", () => {
  it('renders missing values as "" and reports them; unknown tags stay literal', () => {
    const result = renderEmailTemplate(
      {
        subject: "Hi {first_name}{frist_name}",
        bodyHtml: "<p>{company}</p>",
        bodyText: "{company}",
      },
      { firstName: "Ken" },
    );

    expect(result.subject).toBe("Hi Ken{frist_name}");
    expect(result.bodyHtml).toBe("<p></p>");
    expect(result.bodyText).toBe("");
    expect(result.missingTags).toEqual(["company"]);
    expect(result.unknownTags).toEqual(["frist_name"]);
    expect(result.unknownVariables).toEqual([]);
  });

  it("treats an empty-string context value as missing (Cvent blank-field parity)", () => {
    const result = renderEmailTemplate(
      { subject: "{company}!", bodyHtml: "", bodyText: "" },
      { company: "" },
    );

    expect(result.subject).toBe("!");
    expect(result.missingTags).toEqual(["company"]);
  });
});

describe("renderEmailTemplate — template variables", () => {
  it("resolves org/event/recipient variables before merge tags", () => {
    const result = renderEmailTemplate(
      {
        subject: "{{organization_name}} — {{Recipients_name}}",
        bodyHtml:
          "<p>{{EVENT_NAME}}</p><p>{{RECIPIENT_FIRST_NAME}}</p><p>{event_title}</p>",
        bodyText:
          "{{EVENT_NAME}} / {{RECIPIENTS_NAME}} / {{RECIPIENT_EMAIL}} / {event_title}",
      },
      {
        ...FULL_CONTEXT,
        variables: {
          ORGANIZATION_NAME: "Eventa",
          EVENT_NAME: "Summit Week",
          RECIPIENT_NAME: "Kenneth Cha",
          RECIPIENTS_NAME: "Kenneth Cha",
          RECIPIENT_FIRST_NAME: "Kenneth",
          RECIPIENTS_FIRST_NAME: "Kenneth",
          RECIPIENT_EMAIL: "kenneth@example.com",
          RECIPIENTS_EMAIL: "kenneth@example.com",
        },
      },
    );

    expect(result.subject).toBe("Eventa — Kenneth Cha");
    expect(result.bodyHtml).toContain("<p>Summit Week</p>");
    expect(result.bodyHtml).toContain("<p>Kenneth</p>");
    expect(result.bodyHtml).toContain("<p>Innovation@50x Summit</p>");
    expect(result.bodyText).toBe(
      "Summit Week / Kenneth Cha / kenneth@example.com / Innovation@50x Summit",
    );
  });

  it("keeps unknown variables literal and still resolves known merge tags", () => {
    const result = renderEmailTemplate(
      {
        subject: "{{UNKNOWN_KEY}} {first_name}",
        bodyHtml: "<p>{{UNKNOWN_KEY}}</p>",
        bodyText: "{{UNKNOWN_KEY}}",
      },
      { firstName: "Ken" },
    );

    expect(result.subject).toBe("{{UNKNOWN_KEY}} Ken");
    expect(result.bodyHtml).toBe("<p>{{UNKNOWN_KEY}}</p>");
    expect(result.bodyText).toBe("{{UNKNOWN_KEY}}");
    expect(result.unknownVariables).toEqual(["UNKNOWN_KEY"]);
  });
});

describe("renderEmailTemplate — {qr_code} placement (AC-5)", () => {
  it("inserts the QR SVG raw in bodyHtml only; the raw token appears in NO rendered text", async () => {
    const token = mintQrToken({
      eventId: "evt-1",
      formDataId: "sub-1",
      secret: QR_SECRET,
    });
    const qrCodeSvg = await QRCode.toString(token, { type: "svg", margin: 0 });

    // The same token the M5 scanner resolves round-trips its verification.
    expect(verifyQrToken({ token, secret: QR_SECRET })).toEqual({
      valid: true,
      eventId: "evt-1",
      formDataId: "sub-1",
    });

    const result = renderEmailTemplate(
      {
        subject: "Badge {qr_code}",
        bodyHtml: "<div>{qr_code}</div>",
        bodyText: "Badge: {qr_code} (attached)",
      },
      { qrCodeSvg },
    );

    expect(result.bodyHtml).toBe(`<div>${qrCodeSvg}</div>`);
    expect(result.subject).toBe("Badge ");
    expect(result.bodyText).toBe("Badge:  (attached)");
    // M5-T1 AC-6 carry-over: the raw token string never leaks into text.
    expect(result.subject).not.toContain(token);
    expect(result.bodyText).not.toContain(token);
  });

  it("reports {qr_code} missing when no SVG is in the context", () => {
    const result = renderEmailTemplate(
      { subject: "", bodyHtml: "{qr_code}", bodyText: "" },
      {},
    );

    expect(result.bodyHtml).toBe("");
    expect(result.missingTags).toEqual(["qr_code"]);
  });
});

describe("renderEmailTemplate — purity edges (AC-6)", () => {
  it("handles an empty template", () => {
    const result = renderEmailTemplate(
      { subject: "", bodyHtml: "", bodyText: "" },
      FULL_CONTEXT,
    );

    expect(result).toMatchObject({
      subject: "",
      bodyHtml: "",
      bodyText: "",
      usedTags: [],
      missingTags: [],
      unknownTags: [],
      unknownVariables: [],
    });
  });

  it("replaces repeated and adjacent tags (reported once each)", () => {
    const result = renderEmailTemplate(
      {
        subject: "{first_name}{last_name}",
        bodyHtml: "{first_name} and {first_name}",
        bodyText: "",
      },
      { firstName: "Ken", lastName: "Cha" },
    );

    expect(result.subject).toBe("KenCha");
    expect(result.bodyHtml).toBe("Ken and Ken");
    expect(result.usedTags).toEqual(["first_name", "last_name"]);
  });

  it('leaves "{}", "{unclosed" and non-snake-case braces untouched and unreported', () => {
    const result = renderEmailTemplate(
      {
        subject: "{} {unclosed {Upper} {kebab-case}",
        bodyHtml: "",
        bodyText: "",
      },
      FULL_CONTEXT,
    );

    expect(result.subject).toBe("{} {unclosed {Upper} {kebab-case}");
    expect(result.usedTags).toEqual([]);
    expect(result.unknownTags).toEqual([]);
  });

  it("is deterministic (pure function — same input, same output)", () => {
    const template = {
      subject: "{event_title}",
      bodyHtml: "{first_name}",
      bodyText: "{unknown_tag}",
    };
    expect(renderEmailTemplate(template, FULL_CONTEXT)).toEqual(
      renderEmailTemplate(template, FULL_CONTEXT),
    );
  });
});

describe("buildEmailMergeContext — documented sources (§3 table)", () => {
  const EVENT = {
    id: "evt-1",
    name: "Innovation@50x Summit",
    periods: [{ date: "2026-09-01", startTime: "09:00", endTime: "17:00" }],
    timezone: "Europe/London",
  };

  const ATTENDEE = {
    firstName: "Kenneth",
    lastName: "Cha",
    email: "kenneth@example.com",
    company: "The Economist",
    jobTitle: "Editor",
    ticketLabel: "Complimentary delegate",
    registrationTypeLabel: "Delegate",
  };

  it("maps event/attendee/order docs onto the full context", () => {
    const context = buildEmailMergeContext({
      event: EVENT,
      attendee: ATTENDEE,
      order: {
        amounts: {
          subtotalMinor: 129900,
          discountMinor: 0,
          taxMinor: 0,
          totalMinor: 129900,
        },
        currency: "USD",
        paymentStatus: "paid",
      },
      qrCodeSvg: "<svg />",
    });

    expect(context).toMatchObject({
      eventTitle: "Innovation@50x Summit",
      eventDate: "2026-09-01, 09:00 – 17:00 · Europe/London",
      firstName: "Kenneth",
      lastName: "Cha",
      email: "kenneth@example.com",
      company: "The Economist",
      jobTitle: "Editor",
      ticketName: "Complimentary delegate",
      registrationType: "Delegate",
      orderTotal: "$1,299.00",
      paymentStatus: "Paid",
      qrCodeSvg: "<svg />",
      eventUrl: "/events/evt-1",
    });
  });

  it("falls back to submission keys pre-accept (no attendee yet)", () => {
    const context = buildEmailMergeContext({
      event: EVENT,
      submission: {
        first_name: "Maria",
        last_name: "Lopez",
        email: "maria@example.com",
        company: "Acme",
        job_title: "CTO",
      },
    });

    expect(context).toMatchObject({
      firstName: "Maria",
      lastName: "Lopez",
      email: "maria@example.com",
      company: "Acme",
      jobTitle: "CTO",
    });
  });

  it('maps the admin-only "—" fallback labels to absent (emails render "")', () => {
    const context = buildEmailMergeContext({
      event: EVENT,
      attendee: { ...ATTENDEE, ticketLabel: "—", registrationTypeLabel: "—" },
    });

    expect(context.ticketName).toBeUndefined();
    expect(context.registrationType).toBeUndefined();
  });

  it("leaves order-derived and date values absent when their sources are missing", () => {
    const context = buildEmailMergeContext({
      event: { ...EVENT, periods: [] },
      attendee: ATTENDEE,
      order: null,
    });

    expect(context.eventDate).toBeUndefined(); // "" render (no periods)
    expect(context.orderTotal).toBeUndefined(); // free/legacy — no order
    expect(context.paymentStatus).toBeUndefined();
  });

  it("humanizes every payment status", () => {
    expect(PAYMENT_STATUS_LABELS).toEqual({
      pending: "Payment due",
      outstanding: "Payment due",
      failed: "Payment due",
      paid: "Paid",
      comped: "Complimentary",
    });
  });

  it("formats order totals in the order currency (integer minor units)", () => {
    expect(
      formatOrderTotal({ amounts: { totalMinor: 129900 }, currency: "USD" }),
    ).toBe("$1,299.00");
    expect(
      formatOrderTotal({ amounts: { totalMinor: 0 }, currency: "EUR" }),
    ).toBe("€0.00");
  });

  it("builds the public event URL relative by default, absolute with a base", () => {
    expect(publicEventUrl("evt-1")).toBe("/events/evt-1");
    expect(publicEventUrl("evt-1", "https://example.com/")).toBe(
      "https://example.com/events/evt-1",
    );
  });
});
