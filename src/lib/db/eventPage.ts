import { serverTimestamp } from "firebase/firestore";

import { createCollectionApi } from "@/lib/db/base";
import type { EventPageDoc } from "@/types/collection";

const eventPageApi = createCollectionApi<EventPageDoc>("EventPage");

export { serverTimestamp };

export const {
  create: createEventPage,
  set: setEventPage,
  getById: getEventPageById,
  getAll: getEventPages,
  update: updateEventPage,
  remove: deleteEventPage,
  findWhere: findEventPagesByField,
} = eventPageApi;
