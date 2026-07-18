import type {
  EventDoc,
  PaymentMethod,
  WithId,
} from "@/types/collection";

export type EventOverviewCountResult =
  | { value: number }
  | { loadError: true };

export type EventOverviewRevenueResult =
  | { kind: "unconfigured" }
  | {
      kind: "currencies";
      amounts: Array<{ currency: string; paidMinor: number }>;
    }
  | { loadError: true };

export type EventOverviewPathsResult =
  | { active: number; total: number; methods: PaymentMethod[] }
  | { loadError: true };

export type EventOverviewReadinessState = "done" | "pending" | "unknown";

export type EventOverviewReadinessId =
  | "event-published"
  | "custom-page-published"
  | "registration-form-published"
  | "ticket-types-pricing-set"
  | "confirmation-email-active"
  | "checkin-configured";

export interface EventOverviewReadinessEntry {
  id: EventOverviewReadinessId;
  state: EventOverviewReadinessState;
  label: string;
  detail: string;
  href?: string;
}

export interface EventOverviewIdentity {
  category: "Not set";
  timezone: string;
  visibility: "Public" | "Private (draft)";
  paths: EventOverviewPathsResult;
}

export interface EventOverviewData {
  event: WithId<EventDoc>;
  registered: EventOverviewCountResult;
  invited: EventOverviewCountResult;
  revenue: EventOverviewRevenueResult;
  abandoned: EventOverviewCountResult;
  identity: EventOverviewIdentity;
  readiness: EventOverviewReadinessEntry[];
}
