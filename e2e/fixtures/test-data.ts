// Shared test data for the authoritative real-account M0/M1/M2 browser pass.
// The account credentials come exclusively from E2E_EMAIL/E2E_PASSWORD.
// One dedicated organization and event are intentionally persisted for
// Phases 2-4; no test may create another organization or event.

export const ORG_NAME_BASE = "E2E QA Org 2026-07-26 v2";
export const EVENT_NAME = "E2E QA Conference 2026 Phase 1";
export const EVENT_TIMEZONE = "Asia/Singapore";
export const EVENT_START_DATE = "2026-11-15";
export const EVENT_END_DATE = "2026-11-16";
// DEFECT NOTE: src/features/event/schema.ts's eventRegistrationPeriodSchema
// rejects a registrationPeriod.startDate earlier than "today" at submit time
// (client Zod validation, no visible error surfaced by the harness — see
// agents/docs/qa/e2e-regression-m0-m1-m2.md). This constant must stay >=
// the date this suite is actually run on, not the date the fixture file was
// first authored (2026-07-26) — bumped for the 2026-07-30 rerun.
export const REGISTRATION_START_DATE = "2026-07-30";
export const REGISTRATION_END_DATE = "2026-11-14";
export const EARLY_BIRD_SALES_END_DATE = "2026-09-30";
export const STANDARD_SALES_START_DATE = "2026-10-01";
export const DISCOUNT_VALID_FROM_DATE = "2026-07-26";
export const DISCOUNT_VALID_UNTIL_DATE = "2026-12-31";

export const AUTH_STORAGE_STATE = "e2e/.auth/user.json";
export const FIXTURES_FILE = "e2e/.auth/fixtures.json";
export const ORG_RESERVATION_FILE = "e2e/.auth/org-reservation.json";
export const REAL_ACCOUNT_RUN_MARKER =
  "phase-1-real-account-2026-07-26-authoritative";

export interface SeededFixtures {
  runMarker: typeof REAL_ACCOUNT_RUN_MARKER;
  organizationId: string;
  organizationName: string;
  eventId: string;
  eventName: string;
  eventDashboardUrl: string;
  eventTimezone: string;
  eventStartDate: string;
  eventEndDate: string;
  registrationStartDate: string;
  registrationEndDate: string;
  preexistingOrganizations: Array<{
    id: string;
    name: string;
    role: string;
    status: string | null;
  }>;
}
