// API routes: GET/POST /api/dashboard/events/[eventId]/reports/schedules
// M7-T3 spec §1/§4. GET lists the event's 0-5 existing schedules (the
// "management surface" data, write:events-gated per spec §4 — this is a
// mutating-adjacent config surface, not a Run-tier read); POST creates OR
// upserts a schedule for the given templateSlug (spec §4 AC-1: a second
// create call for the same template edits the existing doc rather than
// creating a second one — Backend's upsertAdminReportSchedule already
// implements this at the deterministic-id level).
import { NextResponse } from "next/server";

import { readReportsRouteJsonBody } from "@/features/reports/server/read-json-body";
import { serializeReportSchedule } from "@/features/reports/server/serialize-report-schedule";
import { resolveReportsRouteScope } from "@/features/reports/server/reports-route-scope";
import type { ReportScheduleRecipientError } from "@/features/reports/types";
import { isReportTemplateId } from "@/features/reports/templates";
import {
  listAdminReportSchedulesForEvent,
  upsertAdminReportSchedule,
} from "@/lib/db/adminReportSchedule";
import { checkRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const NOT_A_MEMBER_REASON =
  "This email isn't a member of your organization — invite them first.";

function recipientErrorsFor(emails: string[]): ReportScheduleRecipientError[] {
  return emails.map((email) => ({ email, reason: NOT_A_MEMBER_REASON }));
}

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveReportsRouteScope(eventId, {
    requireWriteEvents: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const stored = await listAdminReportSchedulesForEvent({
    eventId,
    organizationId: scope.organizationId,
  });

  return NextResponse.json({
    schedules: stored.map(serializeReportSchedule),
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveReportsRouteScope(eventId, {
    requireWriteEvents: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const rate = checkRateLimit(
    `reports-schedules-post:${scope.userId}:${eventId}`,
    { limit: 20 },
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many attempts — wait a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const rawBody = await readReportsRouteJsonBody(request);
  if (!rawBody.ok) {
    return rawBody.reason === "too_large"
      ? NextResponse.json({ error: "Request body too large." }, { status: 413 })
      : NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const bodyObj =
    rawBody.body && typeof rawBody.body === "object"
      ? (rawBody.body as Record<string, unknown>)
      : {};
  const { templateSlug, ...patch } = bodyObj;

  if (typeof templateSlug !== "string" || !isReportTemplateId(templateSlug)) {
    return NextResponse.json(
      { error: "Unknown report template." },
      { status: 400 },
    );
  }

  const result = await upsertAdminReportSchedule({
    organizationId: scope.organizationId,
    eventId,
    templateSlug,
    createdBy: scope.userId,
    patch,
  });

  if (!result.ok) {
    if (result.code === "NOT_A_MEMBER") {
      return NextResponse.json(
        {
          error: "One or more recipients could not be added.",
          recipientErrors: recipientErrorsFor(result.emails),
        },
        { status: 422 },
      );
    }
    if (result.code === "VALIDATION") {
      return NextResponse.json(
        { error: result.issues.join(" ") },
        { status: 400 },
      );
    }
    if (result.code === "UNKNOWN_TEMPLATE") {
      return NextResponse.json(
        { error: "Unknown report template." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      schedule: serializeReportSchedule(result.schedule),
      created: result.created,
    },
    { status: result.created ? 201 : 200 },
  );
}
