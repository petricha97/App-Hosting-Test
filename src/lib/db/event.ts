import { serverTimestamp } from "firebase/firestore";
import { createCollectionApi } from "@/lib/db/base";
import type { EventDoc } from "@/types/collection";

const eventApi = createCollectionApi<EventDoc>("Event");

export { serverTimestamp };

export const {
    create: createEvent,
    set: setEvent,
    getById: getEventById,
    getAll: getEvents,
    update: updateEvent,
    remove: deleteEvent,
    findWhere: findEventsByField,
    findMany: findManyEvents,
} = eventApi;
//factory pattern 


// Example of the factory pattern. Not fully tested. Need to add pagination.

// Get Event
// const eventId = await eventApi.create(data);
// OR
// const eventId = await createEvent({
//     allowOverlap: false,
//     capacity: 50,
//     createdAt: serverTimestamp(),
//     updatedAt: serverTimestamp(),
//     description: "Annual Tech Meetup",
//     expectedGuests: 40,
//     formPath: "/forms/tech-meetup",
//     invoicePath: "/invoices/tech-meetup",
//     name: "Tech Meetup 2026",
//     organizationPath: "/organizations/dev-club",
//     periods: [
//         new Map([
//             ["start", "2026-05-01T10:00:00"],
//             ["end", "2026-05-01T12:00:00"],
//         ])
//     ],
//     status: "Draft",
//     timezone: "Asia/Singapore",
// });

// // Get Event by Id
// const event = await getEventById("abc123");

// // Get all Events
// const events = await getEvents();

// // Update Event
// await updateEvent("abc123", {
//     status: "Published",
//     updatedAt: serverTimestamp(),
// });


// // Query Event
// const publishedEvents = await findEventsByField("status", "Published");


// // Custom query using Firestore constraints
// import { where, orderBy, limit } from "firebase/firestore";
// import { findManyEvents } from "@/lib/db/event";

// const events = await findManyEvents(
//     where("status", "==", "Published"),
//     orderBy("createdAt", "desc"),
//     limit(5)
// );

// // Delete Event
// await deleteEvent("abc123");