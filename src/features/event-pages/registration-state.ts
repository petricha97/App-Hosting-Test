// Pure resolution of the RegistrationEmbed block's behavior branch
// (M4-T1 block 3, AC-13/14/15). Client-safe: no Firebase imports.
//
// - "no_paths": the event has never configured a registration path → the
//   legacy inline form renders (existing pages unaffected, AC-14).
// - "open": ≥1 active path AND the form is published → CTA into the M3
//   multi-step flow (AC-13).
// - "closed": paths exist but none is active, or the form is unpublished →
//   a disabled "Registration is currently closed" notice, never a dead link
//   and never a hidden block (AC-15).

export type RegistrationCtaState = "open" | "closed" | "no_paths";

export function resolveRegistrationCtaState(input: {
  hasPublishedForm: boolean;
  totalPaths: number;
  activePaths: number;
}): RegistrationCtaState {
  if (input.totalPaths === 0) return "no_paths";
  if (input.activePaths >= 1 && input.hasPublishedForm) return "open";
  return "closed";
}
