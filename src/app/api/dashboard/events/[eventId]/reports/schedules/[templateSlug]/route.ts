// API routes: GET/PATCH/DELETE
// /api/dashboard/events/[eventId]/reports/schedules/[templateSlug]
// M7-T3 spec §4. GET fetches the single schedule for that template (404 if
// never configured) — used by the dialog to pre-populate the edit form
// directly by slug. PATCH is the SAME upsert entrypoint as the collection
// route's POST (D5: "editing a schedule is an upsert onto this same
// [deterministic] id") — also how pause/resume works (the client resends
// the full config with `enabled` flipped; Backend's DAL re-verifies
// recipients on every upsert regardless, so there is no separate
// lightweight toggle entrypoint to keep in sync). DELETE hard-removes the
// schedule (spec §4 — no soft-delete concept).
import { NextResponse } from "next/server";

import { readReportsRouteJsonBody } from "@/features/reports/server/read-json-body";
import { serializeReportSchedule } from "@/features/reports/server/serialize-report-schedule";
import { resolveReportsRouteScope } from "@/features/reports/server/reports-route-scope";
import type { ReportScheduleRecipientError } from "@/features/reports/types";
import { isReportTemplateId } from "@/features/reports/templates";
import {
  deleteAdminReportSchedule,
  getAdminReportScheduleByTemplate,
  upsertAdminReportSchedule,
} from "@/lib/db/adminReportSchedule";
import { reportScheduleId } from "@/lib/db/reportScheduleId";
import { checkRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string; templateSlug: string }>;
}

const NOT_A_MEMBER_REASON =
  "This email isn't a member of your organization — invite them first.";

function recipientErrorsFor(emails: string[]): ReportScheduleRecipientError[] {
  return emails.map((email) => ({ email, reason: NOT_A_MEMBER_REASON }));
}

export async function GET(_request: Request, context: RouteContext) {
  const { eventId, templateSlug } = await context.params;
  const scope = await resolveReportsRouteScope(eventId, {
    requireWriteEvents: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  if (!isReportTemplateId(templateSlug)) {
    return NextResponse.json(
      { error: "Unknown report template." },
      { status: 400 },
    );
  }

  const schedule = await getAdminReportScheduleByTemplate({
    templateSlug,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!schedule) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  return NextResponse.json({ schedule: serializeReportSchedule(schedule) });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId, templateSlug } = await context.params;
  const scope = await resolveReportsRouteScope(eventId, {
    requireWriteEvents: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  if (!isReportTemplateId(templateSlug)) {
    return NextResponse.json(
      { error: "Unknown report template." },
      { status: 400 },
    );
  }

  const rate = checkRateLimit(
    `reports-schedules-patch:${scope.userId}:${eventId}`,
    { limit: 60 },
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
  // templateSlug is addressed by the route param, never trusted from the
  // body — stripped before it reaches the DAL's patch schema.
  const { templateSlug: _ignored, ...patch } = bodyObj;

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

  return NextResponse.json({
    schedule: serializeReportSchedule(result.schedule),
    created: result.created,
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { eventId, templateSlug } = await context.params;
  const scope = await resolveReportsRouteScope(eventId, {
    requireWriteEvents: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  if (!isReportTemplateId(templateSlug)) {
    return NextResponse.json(
      { error: "Unknown report template." },
      { status: 400 },
    );
  }

  const rate = checkRateLimit(
    `reports-schedules-delete:${scope.userId}:${eventId}`,
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

  const scheduleId = reportScheduleId({
    organizationId: scope.organizationId,
    eventId,
    templateSlug,
  });

  const result = await deleteAdminReportSchedule({
    scheduleId,
    eventId,
    organizationId: scope.organizationId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
