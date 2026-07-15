// Resolves an EmailDefinition's EFFECTIVE (stored-or-virtual-default) send
// inputs — the same "stored always wins over the in-code catalog" merge the
// T2 list screen uses (src/features/emails/default-definitions.ts), reduced
// to just what a real-time trigger hook or a bulk-send route needs to
// render + gate a send: subject/body template, the deterministic
// definitionId, and the CURRENT enabled flag.
//
// Reused by every T3 real-time firing path — on-submit
// (fire-on-submit-email.ts), on-accept (fire-on-accept-email.ts) and the
// "Email all" bulk route (drafts/email-all/route.ts) — spec:
// agents/docs/specs/m6-lifecycle-triggers.md. Every caller re-reads through
// here at FIRE TIME (never a value cached earlier in the request), which is
// what satisfies the spec's "enabled re-check, never cached" obligation
// (§1/§2/§7) without each call site re-deriving the merge itself.
import "server-only";

import { getDefaultEmailDefinition } from "@/features/emails/default-definitions";
import { getAdminEmailDefinitionByKind } from "@/lib/db/adminEmailDefinition";
import { emailDefinitionId } from "@/lib/db/emailDefinitionId";

export interface EffectiveEmailDefinition {
  definitionId: string;
  subject: string;
  body: string;
  enabled: boolean;
}

// null = the kind matches neither a stored doc nor a catalog default. Not
// reachable for the fixed system kinds this spec's triggers fire against
// (approval-pending / confirmation-paid / confirmation-payment-due /
// abandoned-reminder always exist in the catalog), but callers must handle
// it without crashing rather than assume it can never happen.
export async function resolveEffectiveEmailDefinition(input: {
  kind: string;
  eventId: string;
  organizationId: string;
}): Promise<EffectiveEmailDefinition | null> {
  const stored = await getAdminEmailDefinitionByKind(input);
  const defaultEntry = getDefaultEmailDefinition(input.kind);
  if (!stored && !defaultEntry) return null;

  const definitionId = emailDefinitionId(input);

  if (stored) {
    return {
      definitionId,
      subject: stored.subject,
      body: stored.body,
      enabled: stored.enabled,
    };
  }

  return {
    definitionId,
    subject: defaultEntry!.subject,
    body: defaultEntry!.body,
    enabled: true,
  };
}
