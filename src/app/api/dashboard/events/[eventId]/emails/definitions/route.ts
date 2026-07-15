// API routes: GET/POST /api/dashboard/events/[eventId]/emails/definitions
// M6-T2 spec §2/§7. GET returns the MERGED list (virtual catalog + stored
// docs, zero writes — spec §1 AC-1); POST creates a brand-new CUSTOM
// definition (server-minted "custom-*" kind, spec §2 AC-2). Both write:events
// -gated + 404 cross-org via the shared registration route scope (M5 L-4
// convention: ALL email routes gate write:events, including reads).
import { NextResponse } from "next/server";

import { mergeEmailDefinitions } from "@/features/emails/default-definitions";
import { readEmailRouteJsonBody } from "@/features/emails/server/read-json-body";
import { wireTriggerToSchemaInput } from "@/features/emails/server/trigger-wire";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import {
  listAdminEmailDefinitionsForEvent,
  mintCustomEmailDefinitionKind,
  upsertAdminEmailDefinition,
} from "@/lib/db/adminEmailDefinition";
import { emailDefinitionCreateCustomSchema } from "@/lib/email/schemas";
import { checkRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const stored = await listAdminEmailDefinitionsForEvent({
    eventId,
    organizationId: scope.organizationId,
  });

  const definitions = mergeEmailDefinitions({
    stored,
    event: scope.event,
    organizationId: scope.organizationId,
    eventId,
  });

  return NextResponse.json({ definitions });
}

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const rate = checkRateLimit(
    `emails-definitions-post:${scope.userId}:${eventId}`,
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
  const candidate = {
    ...bodyObj,
    trigger: wireTriggerToSchemaInput(bodyObj.trigger),
  };

  const parsed = emailDefinitionCreateCustomSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Custom rows sort after every default (sortOrder 0-7) and after any
  // existing customs — spec §1 "ordered by sortOrder then createdAt".
  const stored = await listAdminEmailDefinitionsForEvent({
    eventId,
    organizationId: scope.organizationId,
  });
  const nextSortOrder =
    Math.max(7, ...stored.map((definition) => definition.sortOrder)) + 1;

  const kind = mintCustomEmailDefinitionKind();
  const result = await upsertAdminEmailDefinition({
    organizationId: scope.organizationId,
    eventId,
    kind,
    isSystem: false,
    ifAbsent: { ...parsed.data, sortOrder: nextSortOrder },
    patch: {},
  });

  if (!result.ok) {
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
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const definitions = mergeEmailDefinitions({
    stored: [...stored, result.definition],
    event: scope.event,
    organizationId: scope.organizationId,
    eventId,
  });
  const created = definitions.find((definition) => definition.kind === kind);

  return NextResponse.json({ definition: created }, { status: 201 });
}
