// API route: POST /api/dashboard/events/[eventId]/emails/test-send
// Spec §5: "the one send affordance in T2" — renders the target definition
// (stored or virtual default) with the §3 sample context and calls
// sendEventEmail with kind:"test", a fresh server-minted dedupeKey per call
// (double-click => two rows, by design — the client-side in-flight guard is
// the dedupe UX, not the server). Disabled definitions refuse test send
// (§2 AC-5). Rate limit: 10/min/user/event (§5).
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getDefaultEmailDefinition } from "@/features/emails/default-definitions";
import { deriveBodyForDefinition } from "@/features/emails/server/render";
import { readEmailRouteJsonBody } from "@/features/emails/server/read-json-body";
import { resolveEmailBlockRenderContext } from "@/features/emails/server/resolve-block-context";
import { loadSampleEmailContext } from "@/features/emails/server/sample-context";
import {
  attachEmailTemplateVariables,
  loadEmailTemplateVariableSource,
} from "@/features/emails/server/template-variables";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import { getAdminEmailDefinitionByKind } from "@/lib/db/adminEmailDefinition";
import { emailDefinitionId } from "@/lib/db/emailDefinitionId";
import { emailAddressSchema } from "@/lib/email/schemas";
import { sendEventEmail } from "@/lib/email/send-service";
import { checkRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

const TestSendSchema = z.object({
  kind: z.string().trim().min(1).max(200),
  recipientEmail: emailAddressSchema,
});

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const rate = checkRateLimit(`emails-test-send:${scope.userId}:${eventId}`, {
    limit: 10,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many test sends — wait a moment." },
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

  const parsed = TestSendSchema.safeParse(rawBody.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { kind, recipientEmail } = parsed.data;

  const stored = await getAdminEmailDefinitionByKind({
    kind,
    eventId,
    organizationId: scope.organizationId,
  });
  const defaultEntry = getDefaultEmailDefinition(kind);
  if (!stored && !defaultEntry) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  // M6-T4: bodyMode/bodyBlocks carried through so a block-designed
  // definition's test-send renders the same block-assembled HTML the
  // editor's own preview already shows — a stored doc predating this ticket
  // (or a still-virtual default) falls back to "text"/[] (spec §2 AC-5).
  const effective = stored
    ? {
        subject: stored.subject,
        body: stored.body,
        enabled: stored.enabled,
        bodyMode: stored.bodyMode ?? ("text" as const),
        bodyBlocks: stored.bodyBlocks ?? [],
      }
    : {
        subject: defaultEntry!.subject,
        body: defaultEntry!.body,
        enabled: true,
        bodyMode: "text" as const,
        bodyBlocks: [],
      };

  if (!effective.enabled) {
    return NextResponse.json(
      { error: "This email is off — turn it on to send a test." },
      { status: 409 },
    );
  }

  // M6-T4 B-1 fix: a test-send is a real send — RegistrationEmbed/
  // TicketPricingTable/CountdownTimer must render real data here, not the
  // empty-state fallback, for a test recipient to actually verify them.
  const [sample, blockContext, variableSource] = await Promise.all([
    loadSampleEmailContext({
      eventId,
      organizationId: scope.organizationId,
      event: scope.event,
    }),
    resolveEmailBlockRenderContext({
      eventId,
      organizationId: scope.organizationId,
    }),
    loadEmailTemplateVariableSource({
      organizationId: scope.organizationId,
      event: scope.event,
    }),
  ]);

  const definitionId = emailDefinitionId({
    organizationId: scope.organizationId,
    eventId,
    kind,
  });

  const { bodyHtml, bodyText } = deriveBodyForDefinition(
    effective,
    blockContext,
  );

  const result = await sendEventEmail({
    organizationId: scope.organizationId,
    eventId,
    eventName: scope.event.name,
    kind: "test",
    dedupeKey: randomUUID(),
    definitionId,
    recipient: { name: "Test recipient", email: recipientEmail },
    attendeeId: sample.attendee?.id ?? null,
    submissionId: sample.attendee?.submissionId ?? null,
    template: {
      subject: effective.subject,
      bodyHtml,
      bodyText,
    },
    context: attachEmailTemplateVariables({
      context: sample.context,
      source: variableSource,
    }),
  });

  if (!result.ok) {
    const status = result.outcome === "rejected" ? 400 : 502;
    const message =
      result.outcome === "rejected" ? result.message : result.reason;
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({
    ok: true,
    outcome: result.outcome,
    messageId: result.messageId,
    recipientEmail,
  });
}
