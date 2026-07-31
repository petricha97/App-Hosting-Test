// Shared identities for the M3 public-registration specs. Kept in a plain
// fixtures module (not exported from a .spec.ts file) so importing it never
// re-registers another spec file's tests.

export const ACCEPTED_REGISTRANT = {
  firstName: "Priya",
  lastName: "Kapoor",
  email: "priya.kapoor.e2e@example.com",
};

// M3-T5 — abandoned mid-flow (never finalized). Domain matches the spec's
// masked-email worked example ("@dentsu.com").
export const ABANDONED_REGISTRANT = {
  firstName: "Amara",
  lastName: "Osei",
  email: "amara.osei.e2e@dentsu.com",
};

// M5-T2 (Phase 3) — the admin "+ Register attendee" manual-registration
// flow's own identity, distinct from the public-flow registrants above.
export const MANUAL_REGISTRANT = {
  firstName: "Noah",
  lastName: "Fischer",
  email: "noah.fischer.e2e@example.com",
};
