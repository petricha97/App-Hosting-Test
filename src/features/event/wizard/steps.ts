import type { FieldPath } from "react-hook-form";

import type { EventFormInput } from "@/features/event/schema";

export type WizardStepKey =
  "basics" | "schedule" | "registration" | "page" | "review";

export interface WizardStep {
  key: WizardStepKey;
  label: string;
  kicker: string;
  title: string;
  description: string;
  optional?: boolean;
}

export const WIZARD_STEPS: readonly WizardStep[] = [
  {
    key: "basics",
    label: "Details",
    kicker: "Step 1 of 5",
    title: "Event details",
    description:
      "Name your event and set how many people can attend. You can change all of this later.",
  },
  {
    key: "schedule",
    label: "Date & time",
    kicker: "Step 2 of 5",
    title: "Date & time",
    description: "When does it happen, and when can people register?",
  },
  {
    key: "registration",
    label: "Registration",
    kicker: "Step 3 of 5",
    title: "Registration form",
    description:
      "The registration form is created and linked later from the event's Forms area. Tickets and pricing are handled after the event is created.",
    optional: true,
  },
  {
    key: "page",
    label: "Public page",
    kicker: "Step 4 of 5",
    title: "Public page",
    description:
      "Choose what people see when they open your event link. You can leave the default and change this later from the event's Pages area.",
    optional: true,
  },
  {
    key: "review",
    label: "Review",
    kicker: "Step 5 of 5",
    title: "Review & publish",
    description: "Check everything, then save as a draft or publish it live.",
  },
] as const;

/**
 * Fields validated (via `form.trigger`) before leaving a step.
 *
 * Steps 3 (registration) and 4 (public page) are optional and never block Next
 * — with the single exception that step 4 requires `redirectUrl` when the
 * chosen page mode is "redirect" (enforced by the schema's superRefine and
 * surfaced here by triggering the `redirectUrl` path).
 */
export function getStepFields(
  key: WizardStepKey,
  pageMode: EventFormInput["pageMode"],
): Array<FieldPath<EventFormInput>> {
  switch (key) {
    case "basics":
      return ["name", "description", "capacity", "expectedGuests"];
    case "schedule":
      return ["timezone", "allowOverlap", "registrationPeriod", "periods"];
    case "page":
      return pageMode === "redirect" ? ["redirectUrl"] : [];
    case "registration":
    case "review":
    default:
      return [];
  }
}
