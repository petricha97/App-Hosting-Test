// Merge-tag renderer + canonical tag catalog (M6-T1). Spec:
// agents/docs/specs/m6-email-infrastructure.md (§3) — T2/T3/T4 EXTEND the
// catalog here, never fork it.
//
// Syntax: {tag_name}, lowercase snake_case (prototype meta line: "merge tags
// like {event_title}, {first_name}").
//
// PURE FUNCTION — no I/O; callers assemble the context from the DAL
// (merge-context.ts builds it from the Event/Attendee/Order docs, including
// the pre-rendered QR SVG — rendering stays synchronous and deterministic).
//
// Security rules (SEC ACs 2/3):
// - every merged value is HTML-escaped before insertion into bodyHtml;
//   inserted verbatim into bodyText;
// - values merged into subject (header-bound) have CR/LF and all other
//   control characters stripped — no header injection;
// - {qr_code} is the ONLY tag whose replacement is markup (the
//   server-generated SVG — trusted, never user input); it renders "" in
//   subject and bodyText, and the raw QR token never appears in any
//   rendered text (M5-T1 AC-6 carries over: the context carries the SVG,
//   never the token).
//
// Cvent-parity value rules:
// - missing value (tag known, context value absent/empty) renders "" and is
//   reported in missingTags — blank fields never break the send;
// - unknown tag (typo like {frist_name}) stays LITERAL and is reported in
//   unknownTags — silently rendering "" would hide typos from organizers
//   (T2's preview surfaces the warning);
// - escaped-literal syntax (a literal "{first_name}" in copy) is NOT
//   supported in T1 (documented; revisit with the designer in T4).
import "server-only";

import { stripControlChars } from "@/lib/email/schemas";

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

// T1 canonical set (spec §3 table). Sources are documented per tag in
// merge-context.ts, which maps the DAL docs onto EmailMergeContext.
export const EMAIL_MERGE_TAGS = [
  "event_title",
  "event_date",
  "first_name",
  "last_name",
  "full_name",
  "email",
  "company",
  "job_title",
  "ticket_name",
  "registration_type",
  "order_total",
  "payment_status",
  "qr_code",
  "event_url",
] as const;

export type EmailMergeTag = (typeof EMAIL_MERGE_TAGS)[number];

const KNOWN_TAGS: ReadonlySet<string> = new Set(EMAIL_MERGE_TAGS);

// All values are PRE-FORMATTED display strings (money, dates, humanized
// payment status) — the renderer only places and escapes them. Absent /
// empty values render "" (Cvent blank-field parity).
export interface EmailMergeContext {
  eventTitle?: string;
  eventDate?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  company?: string;
  jobTitle?: string;
  ticketName?: string;
  registrationType?: string;
  orderTotal?: string;
  paymentStatus?: string;
  // TRUSTED server-minted SVG/img markup (never user input) — the only
  // markup replacement in the catalog. HTML body only.
  qrCodeSvg?: string;
  eventUrl?: string;
}

const TAG_TO_CONTEXT_KEY: Record<
  Exclude<EmailMergeTag, "full_name" | "qr_code">,
  keyof EmailMergeContext
> = {
  event_title: "eventTitle",
  event_date: "eventDate",
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  company: "company",
  job_title: "jobTitle",
  ticket_name: "ticketName",
  registration_type: "registrationType",
  order_total: "orderTotal",
  payment_status: "paymentStatus",
  event_url: "eventUrl",
};

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export interface EmailTemplateInput {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

export interface RenderEmailTemplateResult {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  // Known tags encountered anywhere in the template (deduped, first-seen
  // order).
  usedTags: EmailMergeTag[];
  // Known tags whose context value was absent/empty — rendered "" (T2's
  // preview warns on these).
  missingTags: EmailMergeTag[];
  // Syntactically valid tags not in the catalog — left LITERAL in the
  // output (typo signal for T2's preview).
  unknownTags: string[];
}

// Tag syntax: {lowercase_snake_case}. "{}", "{unclosed", "{Upper}" and
// "{kebab-case}" are NOT tag syntax — left untouched and unreported.
const TAG_RE = /\{([a-z][a-z0-9_]*)\}/g;

type RenderPart = "subject" | "html" | "text";

// Resolves the RAW (unescaped) value for a known tag; null = value missing.
function resolveTagValue(
  tag: EmailMergeTag,
  context: EmailMergeContext,
): string | null {
  if (tag === "full_name") {
    const full = [context.firstName ?? "", context.lastName ?? ""]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return full.length > 0 ? full : null;
  }

  if (tag === "qr_code") {
    const svg = context.qrCodeSvg ?? "";
    return svg.length > 0 ? svg : null;
  }

  const value = context[TAG_TO_CONTEXT_KEY[tag]] ?? "";
  return value.length > 0 ? value : null;
}

function renderPart(
  input: string,
  part: RenderPart,
  context: EmailMergeContext,
  report: {
    used: Set<EmailMergeTag>;
    missing: Set<EmailMergeTag>;
    unknown: Set<string>;
  },
): string {
  return input.replace(TAG_RE, (literal, tagName: string) => {
    if (!KNOWN_TAGS.has(tagName)) {
      report.unknown.add(tagName);
      return literal;
    }

    const tag = tagName as EmailMergeTag;
    report.used.add(tag);

    const value = resolveTagValue(tag, context);
    if (value === null) {
      report.missing.add(tag);
      return "";
    }

    if (tag === "qr_code") {
      // Block tag, HTML body only: trusted markup inserted RAW in bodyHtml,
      // stripped everywhere else (the raw token never appears in any text).
      return part === "html" ? value : "";
    }

    if (part === "html") return escapeHtml(value);
    if (part === "subject") return stripControlChars(value);
    return value;
  });
}

export function renderEmailTemplate(
  template: EmailTemplateInput,
  context: EmailMergeContext,
): RenderEmailTemplateResult {
  const report = {
    used: new Set<EmailMergeTag>(),
    missing: new Set<EmailMergeTag>(),
    unknown: new Set<string>(),
  };

  const subject = renderPart(template.subject, "subject", context, report);
  const bodyHtml = renderPart(template.bodyHtml, "html", context, report);
  const bodyText = renderPart(template.bodyText, "text", context, report);

  return {
    subject,
    bodyHtml,
    bodyText,
    usedTags: [...report.used],
    missingTags: [...report.missing],
    unknownTags: [...report.unknown],
  };
}
