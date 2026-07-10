// Shared gating for the UNAUTHENTICATED public registration endpoints
// (M3-T3). Every route funnels through here so the gates are identical:
// event must be Published, the event must have a published form, and the
// registration path must exist, belong to the event, and be active.
// All failures collapse to a single 404 shape — cross-tenant/unknown ids are
// indistinguishable from missing ones.
import "server-only";

import { extractOrganizationIdFromPath } from "@/features/event/utils";
import { getAdminPublishedEventById } from "@/lib/db/adminEvent";
import { getAdminPublishedFormForPublicEvent } from "@/lib/db/adminForm";
import { getAdminRegistrationPathForEvent } from "@/lib/db/adminRegistrationPath";
import {
  getAdminRegistrationDraftByIdAndTokenHash,
} from "@/lib/db/adminRegistrationDraft";
import { hashDraftToken, verifyDraftToken } from "@/lib/draft-token";
import type {
  RegistrationDraftDoc,
  RegistrationPathDoc,
  WithId,
} from "@/types/collection";

// Public request bodies are capped at 32KB (spec Shared decisions / T3 AC-12).
export const MAX_PUBLIC_BODY_BYTES = 32 * 1024;

export type PublicRegistrationEvent = NonNullable<
  Awaited<ReturnType<typeof getAdminPublishedEventById>>
>;
export type PublicRegistrationForm = NonNullable<
  Awaited<ReturnType<typeof getAdminPublishedFormForPublicEvent>>
>;

export interface PublicRegistrationContext {
  event: PublicRegistrationEvent;
  organizationId: string;
  form: PublicRegistrationForm;
  path: WithId<RegistrationPathDoc>;
}

export type LoadContextResult =
  | { ok: true; context: PublicRegistrationContext }
  | { ok: false; status: 404; error: string };

const NOT_FOUND: LoadContextResult = {
  ok: false,
  status: 404,
  error: "Registration is not available.",
};

export async function loadPublicRegistrationContext(input: {
  eventId: string;
  pathId: string;
}): Promise<LoadContextResult> {
  const event = await getAdminPublishedEventById(input.eventId);
  if (!event) return NOT_FOUND;

  const organizationId =
    extractOrganizationIdFromPath(event.organizationPath) ?? "";
  if (!organizationId) return NOT_FOUND;

  const form = await getAdminPublishedFormForPublicEvent({
    eventId: input.eventId,
    eventName: event.name,
    organizationId,
    formPath: event.formPath,
  });
  if (!form) return NOT_FOUND;

  const path = await getAdminRegistrationPathForEvent({
    pathId: input.pathId,
    eventId: input.eventId,
    organizationId,
  });
  // Inactive paths 404 on every public surface (T3 AC-1) — indistinguishable
  // from missing.
  if (!path || !path.isActive) return NOT_FOUND;

  return { ok: true, context: { event, organizationId, form, path } };
}

// Loads a draft via the signed token — the SOLE public capability (T3 AC-3).
// Returns null for forged/malformed tokens, unknown drafts, cross-event
// tokens and hash mismatches alike; callers respond 404 for all of them.
export async function loadDraftByToken(input: {
  eventId: string;
  token: string;
}): Promise<WithId<RegistrationDraftDoc> | null> {
  const verified = verifyDraftToken({
    token: input.token,
    eventId: input.eventId,
  });
  if (!verified.valid) return null;

  return getAdminRegistrationDraftByIdAndTokenHash({
    draftId: verified.draftId,
    eventId: input.eventId,
    tokenHash: hashDraftToken(input.token),
  });
}

// Reads a JSON body with the 32KB cap enforced BEFORE parsing. Returns
// { ok: false } for oversized or non-JSON bodies (routes respond 413/400).
export async function readPublicJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; reason: "too_large" | "invalid" }> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: "invalid" };
  }

  // Byte length, not UTF-16 code units — multibyte payloads count fully.
  if (new TextEncoder().encode(text).length > MAX_PUBLIC_BODY_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
