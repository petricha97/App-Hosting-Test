// API routes: PATCH/DELETE
// /api/dashboard/events/[eventId]/emails/definitions/[kind]
// PATCH is the ONE materialize-or-edit entrypoint (spec §2: "a doc is
// materialized... only on the definition's first edit"; data-model note:
// "ifAbsent must be supplied on every edit call, not just the first one").
// DELETE removes a CUSTOM definition only (system defaults have no delete
// affordance — spec §2 AC-6 SYSTEM_LOCKED). Both write:events-gated,
// 404 cross-org.
import { NextResponse } from "next/server";

import {
  defaultDefinitionIfAbsent,
  serializeStoredDefinition,
  storedTriggerToDraft,
} from "@/features/emails/default-definitions";
import { readEmailRouteJsonBody } from "@/features/emails/server/read-json-body";
import { wireTriggerToSchemaInput } from "@/features/emails/server/trigger-wire";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import {
  deleteAdminEmailDefinition,
  getAdminEmailDefinitionByKind,
  upsertAdminEmailDefinition,
} from "@/lib/db/adminEmailDefinition";
import { emailDefinitionEditablePatchSchema } from "@/lib/email/schemas";
import { checkRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string; kind: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId, kind } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const rate = checkRateLimit(
    `emails-definitions-patch:${scope.userId}:${eventId}`,
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

  const rawBody = await readEmailRouteJsonBody(request);
  if (!rawBody.ok) {
    return rawBody.reason === "too_large"
      ? NextResponse.json({ error: "Request body too large." }, { status: 413 })
      : NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const bodyObj =
    rawBody.body && typeof rawBody.body === "object"
      ? (rawBody.body as Record<string, unknown>)
      : {};
  const candidate = { ...bodyObj };
  if ("trigger" in candidate) {
    candidate.trigger = wireTriggerToSchemaInput(candidate.trigger);
  }

  const parsed = emailDefinitionEditablePatchSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const defaultEntry = defaultDefinitionIfAbsent(kind, scope.event);
  let ifAbsent;
  let isSystem: boolean;

  if (defaultEntry) {
    ifAbsent = defaultEntry;
    isSystem = true;
  } else {
    const existing = await getAdminEmailDefinitionByKind({
      kind,
      eventId,
      organizationId: scope.organizationId,
    });
    if (!existing) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }
    ifAbsent = {
      name: existing.name,
      group: existing.group,
      trigger: storedTriggerToDraft(existing.trigger),
      audience: existing.audience,
      enabled: existing.enabled,
      subject: existing.subject,
      body: existing.body,
      sortOrder: existing.sortOrder,
    };
    isSystem = existing.isSystem;
  }

  const result = await upsertAdminEmailDefinition({
    organizationId: scope.organizationId,
    eventId,
    kind,
    isSystem,
    ifAbsent,
    patch: parsed.data,
  });

  if (!result.ok) {
    if (result.code === "LOCKED_FIELDS") {
      return NextResponse.json(
        {
          error: {
            fieldErrors: Object.fromEntries(
              result.fields.map((field) => [
                field,
                ["This field is fixed for default lifecycle emails."],
              ]),
            ),
          },
        },
        { status: 400 },
      );
    }
    if (result.code === "CAP_REACHED") {
      return NextResponse.json(
        { error: "This event has reached the maximum number of emails." },
        { status: 409 },
      );
    }
    if (result.code === "VALIDATION") {
      return NextResponse.json(
        { error: result.issues.join(" ") },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  return NextResponse.json({
    definition: serializeStoredDefinition(result.definition),
    created: result.created,
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { eventId, kind } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const rate = checkRateLimit(
    `emails-definitions-delete:${scope.userId}:${eventId}`,
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

  const existing = await getAdminEmailDefinitionByKind({
    kind,
    eventId,
    organizationId: scope.organizationId,
  });
  if (!existing) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  const result = await deleteAdminEmailDefinition({
    definitionId: existing.id,
    eventId,
    organizationId: scope.organizationId,
  });

  if (!result.ok) {
    if (result.code === "SYSTEM_LOCKED") {
      return NextResponse.json(
        { error: "Default lifecycle emails can't be deleted." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
