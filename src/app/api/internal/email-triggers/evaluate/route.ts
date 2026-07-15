// POST /api/internal/email-triggers/evaluate — the M6-T3 scheduler
// entrypoint (spec agents/docs/specs/m6-lifecycle-triggers.md §8/§9).
//
// Scheduling mechanism (Backend Agent's call, documented in
// agents/docs/data-models/m6-lifecycle-triggers.md): Cloud Scheduler (or any
// equivalent unattended caller — a CI cron, a manual curl during dev) hits
// this HTTP route on a 15-30 minute cadence. Real Cloud Scheduler
// provisioning is a deploy/ops task, NOT done by this ticket (matches
// HANDOVER.md's existing "human task, create before prod deploy" posture
// for the other apphosting.yaml secrets).
//
// NOT a session-authenticated write:events route (§9): nobody's session
// invokes this. Protected instead by a fail-closed shared secret header
// (src/lib/email/lifecycle/evaluator-auth.ts) — same posture as
// QR_TOKEN_SECRET / DRAFT_TOKEN_SECRET. Every DAL call the sweep makes below
// still carries organizationId + eventId (§9 tenancy rule) — this route
// never runs an unscoped cross-tenant query.
//
// Rate limiting (Security Agent finding, agents/docs/security/
// m6-lifecycle-triggers.md, Finding 2 / N-3): the fail-closed shared secret
// is necessary but not sufficient on its own — it protects against an
// unauthenticated caller, not against a caller who already holds a leaked
// secret, or a misconfigured/duplicated Cloud Scheduler job, invoking this
// route far more often than the documented 15-30 minute cadence. There is no
// per-caller identity here (this is a bearer-secret route, not a session),
// so the bucket is keyed on a single fixed string — there is effectively one
// legitimate caller (Cloud Scheduler) regardless of targeted-vs-sweep mode.
// 6/min comfortably allows legitimate retries/overlapping invocations
// (the documented cadence is one call per 15-30 minutes) while giving a hard
// backstop against a runaway loop.
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  EMAIL_TRIGGER_EVALUATOR_HEADER,
  verifyEvaluatorRequestSecret,
} from "@/lib/email/lifecycle/evaluator-auth";
import { runLifecycleTriggerSweep } from "@/lib/email/lifecycle/run-sweep";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const RATE_LIMIT_KEY = "email-trigger-evaluate:global";
const RATE_LIMIT_PER_MINUTE = 6;

// Optional body: tune the sweep, or target exactly one event (used by tests
// / a future "evaluate this event now" admin action — never a bare eventId
// without its organizationId, so a targeted call cannot cross tenants).
//
// Ceilings tightened per Security Agent Finding 2: the previous maxes
// (200/500/200) were 5-10x the documented safe defaults
// (DEFAULT_LIFECYCLE_SWEEP_MAX_EVENTS=25 / DEFAULT_LIFECYCLE_PAGE_SIZE=100 /
// DEFAULT_LIFECYCLE_MAX_PAGES_PER_TRIGGER=20, run-sweep.ts /
// evaluate-event.ts) — effectively unbounded rather than a genuine safety
// ceiling. Now capped at ~2x each default: no legitimate Cloud Scheduler
// caller needs anywhere near the old bounds in one shot.
const EvaluateRequestSchema = z
  .object({
    eventId: z.string().trim().min(1).max(200).optional(),
    organizationId: z.string().trim().min(1).max(200).optional(),
    maxEvents: z.number().int().min(1).max(50).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
    maxPagesPerTrigger: z.number().int().min(1).max(40).optional(),
  })
  .refine((value) => Boolean(value.eventId) === Boolean(value.organizationId), {
    message: "eventId and organizationId must be supplied together.",
  });

async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text || text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const providedSecret = request.headers.get(EMAIL_TRIGGER_EVALUATOR_HEADER);
  if (!verifyEvaluatorRequestSecret(providedSecret)) {
    // Deliberately generic: never distinguish "missing header" from "wrong
    // secret" from "server misconfigured" in the response body (no oracle
    // for an attacker probing this unattended-only route).
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const rate = checkRateLimit(RATE_LIMIT_KEY, { limit: RATE_LIMIT_PER_MINUTE });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many evaluation requests — wait a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const rawBody = await readOptionalJsonBody(request);
  if (rawBody === null) {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const parsed = EvaluateRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const { eventId, organizationId, ...budget } = parsed.data;

  const result = await runLifecycleTriggerSweep({
    ...budget,
    onlyEvent:
      eventId && organizationId ? { eventId, organizationId } : undefined,
  });

  // Summary counts only — never recipient PII in a response body that could
  // land in scheduler/proxy logs.
  return NextResponse.json({
    eventsEvaluated: result.eventsEvaluated,
    events: result.events.map((event) => ({
      eventId: event.eventId,
      triggers: event.results.map((r) => ({
        kind: r.kind,
        pagesProcessed: r.outcome.pagesProcessed,
        enqueued: r.outcome.enqueued,
        duplicates: r.outcome.duplicates,
        rejected: r.outcome.rejected,
        failed: r.outcome.failed,
        stoppedReason: r.outcome.stoppedReason,
      })),
    })),
  });
}
