import { Badge } from "@/components/ui/badge";
import type { EventOverviewData } from "./event-overview-types";
import { EventOverviewRetry } from "./event-overview-retry";

const methodLabels = { card: "Card", invoice: "Invoice", comp: "Comp", none: "None" } as const;

export function EventIdentity({ data }: { data: EventOverviewData }) {
  const paths = data.identity.paths;
  const failed = "loadError" in paths;
  let registration = "Unable to load";
  let payment = "Unable to load";
  if (!failed) {
    registration = `${paths.active > 0 ? "Open" : "Closed"} · ${paths.active} active / ${paths.total} ${paths.total === 1 ? "path" : "paths"}`;
    const methods = paths.methods.map((method) => methodLabels[method]);
    payment = methods.length === 0 ? "Not configured" : `${paths.methods.some((method) => method === "card" || method === "invoice") ? "Simulated · " : ""}${methods.join(" + ")}`;
  }
  const rows = [
    ["Category", "Not set"],
    ["Timezone", data.identity.timezone],
    ["Visibility", data.identity.visibility],
    ["Registration", registration],
    ["Payment", payment],
  ];
  return (
    <section aria-labelledby="event-identity-heading" className="mt-8 border-t border-border pt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="event-identity-heading" className="text-xl font-semibold">Event identity</h2>
        {failed ? <EventOverviewRetry /> : null}
      </div>
      <dl className="mt-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col gap-1 border-b border-border py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
            <dd className={`min-w-0 break-words text-sm sm:text-right ${label === "Category" || (failed && (label === "Registration" || label === "Payment")) ? "text-muted-foreground" : "text-foreground"}`}>
              {label === "Visibility" ? <Badge variant="secondary">{value}</Badge> : value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
