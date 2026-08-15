import { CreateEventWizard } from "@/features/event/create-event-wizard";

/** Route: /dashboard/events/new — the CREATE flow. Renders the step-by-step
 *  wizard (editing an existing event uses the single-page workspace instead). */
export default function DashboardCreateEventPage() {
  return <CreateEventWizard />;
}
