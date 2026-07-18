import Link from "next/link";
import { Button } from "@/components/ui/button";

export function EventQuickActions({ eventId }: { eventId: string }) {
  const actions = [
    ["Open Page Builder", "page-builder"],
    ["Edit Registration Form", "form"],
    ["Manage Ticket Types", "tickets"],
    ["View Attendees", "attendees"],
    ["Set up Check-in", "checkin"],
  ] as const;
  return (
    <section aria-labelledby="quick-actions-heading">
      <h2 id="quick-actions-heading" className="text-xl font-semibold">Quick actions</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        {actions.map(([label, route]) => (
          <Button key={route} asChild variant="outline" className="min-h-11 w-full sm:w-auto">
            <Link href={`/dashboard/events/${eventId}/${route}`}>{label}</Link>
          </Button>
        ))}
      </div>
    </section>
  );
}
