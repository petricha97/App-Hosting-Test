// API routes: GET/PATCH/DELETE
// /api/dashboard/events/[eventId]/emails/settings
// Spec §6: GET resolves stored settings OR the read-time defaults (viewing
// writes nothing, T1 §4 AC-1); PATCH is a full replace of the three identity
// fields (T1 emailSenderIdentitySchema, re-validated here first so field-
// level errors carry a Zod path — the DAL's own VALIDATION result only
// returns flat messages); DELETE resets to platform default (M6-T2 DAL
// addition, flagged for Backend review: deleteAdminEmailSettings).
import { NextResponse } from "next/server";

import { readEmailRouteJsonBody } from "@/features/emails/server/read-json-body";
import type { SerializedEmailSettings } from "@/features/emails/types";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import {
  deleteAdminEmailSettings,
  getAdminEmailSettingsForEvent,
  upsertAdminEmailSettings,
} from "@/lib/db/adminEmailSettings";
import { emailSenderIdentitySchema } from "@/lib/email/schemas";
import { resolveEmailSenderIdentity } from "@/lib/email/sender-identity";
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

  const [identity, stored] = await Promise.all([
    resolveEmailSenderIdentity({
      eventId,
      organizationId: scope.organizationId,
      eventName: scope.event.name,
    }),
    getAdminEmailSettingsForEvent({
      eventId,
      organizationId: scope.organizationId,
    }),
  ]);

  const settings: SerializedEmailSettings = {
    fromName: identity.fromName,
    fromAddress: identity.fromAddress,
    replyTo: identity.replyTo,
    source: identity.source,
    hasStoredDoc: stored !== null,
  };

  return NextResponse.json({ settings });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const rate = checkRateLimit(`emails-settings-patch:${scope.userId}`, {
    limit: 20,
  });
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
    fromName: typeof bodyObj.fromName === "string" ? bodyObj.fromName : "",
    fromAddress:
      typeof bodyObj.fromAddress === "string" ? bodyObj.fromAddress : "",
    replyTo:
      typeof bodyObj.replyTo === "string" && bodyObj.replyTo.trim().length > 0
        ? bodyObj.replyTo
        : null,
  };

  const parsed = emailSenderIdentitySchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await upsertAdminEmailSettings({
    eventId,
    organizationId: scope.organizationId,
    settings: parsed.data,
  });

  if (!result.ok) {
    if (result.code === "VALIDATION") {
      return NextResponse.json(
        { error: result.issues.join(" ") },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const settings: SerializedEmailSettings = {
    fromName: result.settings.fromName,
    fromAddress: result.settings.fromAddress,
    replyTo: result.settings.replyTo,
    source: "settings",
    hasStoredDoc: true,
  };

  return NextResponse.json({ settings });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const rate = checkRateLimit(`emails-settings-delete:${scope.userId}`, {
    limit: 20,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many attempts — wait a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const result = await deleteAdminEmailSettings({
    eventId,
    organizationId: scope.organizationId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const identity = await resolveEmailSenderIdentity({
    eventId,
    organizationId: scope.organizationId,
    eventName: scope.event.name,
  });

  const settings: SerializedEmailSettings = {
    fromName: identity.fromName,
    fromAddress: identity.fromAddress,
    replyTo: identity.replyTo,
    source: identity.source,
    hasStoredDoc: false,
  };

  return NextResponse.json({ settings });
}
