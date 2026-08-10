// API route: POST /api/dashboard/events/[eventId]/emails/preview
// Live editor preview (spec §3): renders UNSAVED subject/body against the
// same sample-context / render pipeline as the confirmation card and
// test-send ("one render pipeline, not two"). Never persists anything.
import { NextResponse } from "next/server";
import { z } from "zod";

import { renderEmailDefinitionPreview } from "@/features/emails/server/render";
import { readEmailRouteJsonBody } from "@/features/emails/server/read-json-body";
import { resolveEmailBlockRenderContext } from "@/features/emails/server/resolve-block-context";
import { loadSampleEmailContext } from "@/features/emails/server/sample-context";
import {
  attachEmailTemplateVariables,
  loadEmailTemplateVariableSource,
} from "@/features/emails/server/template-variables";
import { resolveRegistrationRouteScope } from "@/features/registration/server/route-scope";
import {
  emailBodyBlocksSchema,
  emailBodyModeSchema,
  emailDefinitionBodySchema,
  emailDefinitionSubjectSchema,
} from "@/lib/email/schemas";
import { checkRateLimit } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

// M6-T4 (spec §4 "no new API route" — this one's request/response shape is
// only WIDENED): bodyMode/bodyBlocks are optional so a Plain-text-mode
// caller's existing {subject, body} payload keeps working unmodified.
// renderEmailDefinitionPreview (src/features/emails/server/render.ts,
// Backend scope) already absorbs both branches internally — this route only
// threads the extra fields through.
const PreviewSchema = z.object({
  subject: emailDefinitionSubjectSchema,
  body: emailDefinitionBodySchema,
  bodyMode: emailBodyModeSchema.optional(),
  bodyBlocks: emailBodyBlocksSchema.optional(),
});

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveRegistrationRouteScope(eventId);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  // Fired on every debounced keystroke — generous but bounded (defense
  // against a runaway client, not a hard spec requirement for reads).
  const rate = checkRateLimit(`emails-preview:${scope.userId}`, { limit: 120 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many preview requests — wait a moment." },
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

  const parsed = PreviewSchema.safeParse(rawBody.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // M6-T4 B-1 fix: the editor's own live preview — per spec §3.2 the
  // "authoritative" surface an organizer is told to trust — resolves real
  // pricing/registration/countdown data (once per request, never per
  // recipient) so RegistrationEmbed/TicketPricingTable/CountdownTimer show
  // real content here instead of always falling back to their empty state.
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

  const rendered = renderEmailDefinitionPreview({
    subjectTemplate: parsed.data.subject,
    bodyTemplate: parsed.data.body,
    context: attachEmailTemplateVariables({
      context: sample.context,
      source: variableSource,
    }),
    bodyMode: parsed.data.bodyMode,
    bodyBlocks: parsed.data.bodyBlocks,
    blockContext,
  });

  return NextResponse.json({
    subject: rendered.subject,
    bodyHtml: rendered.bodyHtml,
    bodyText: rendered.bodyText,
    missingTags: rendered.missingTags,
    unknownTags: rendered.unknownTags,
    unknownVariables: rendered.unknownVariables,
  });
}
