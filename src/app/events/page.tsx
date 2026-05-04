import { PublicEventsIndex } from "@/features/public-events/components/public-events-index";
import { serializeEvents } from "@/features/event/utils";
import { getAdminPublishedEvents } from "@/lib/db/adminEvent";

export default async function PublicEventsPage() {
  const events = await getAdminPublishedEvents();

  return <PublicEventsIndex events={serializeEvents(events)} />;
}
