# M9-T2 — Ticket setup data access

The simplified UI retains the existing `RegistrationType`, `TicketType`, and `Fee` shapes. No document migration, new collection or security-rule change is needed.

## Default audience

`POST /api/dashboard/events/{eventId}/registration-types/default` accepts `{ capacity: number | null }` and returns `{ registrationTypeId, name, code, capacity }`. Capacity is required, nullable for unlimited, otherwise an integer from 1 to 1,000,000. The route strips additional fields. It resolves the session, active organization membership, `write:events` permission and event ownership using the existing registration scope resolver.

The DAL creates an ordinary registration type only on explicit submission. Its document ID is `default-` followed by the SHA-256 of the JSON tuple `[organizationId, eventId]`. This stable identity is shared by retries and simultaneous default requests. Inside a Firestore transaction, a document read precedes creation. A conflicting creation causes Firestore to retry and return the saved document. The existing document must match both event and organization; mismatches return an IDOR-safe 404.

```ts
// Existing RegistrationType shape, no additional fields.
{
  organizationId: string;
  eventId: string;
  name: "General attendee"; // Initial value; subsequently editable normally.
  code: "GENERAL";         // Initial value; subsequently editable normally.
  capacity: number | null;
  registeredCount: 0;
  createdAt: serverTimestamp;
  updatedAt: serverTimestamp;
}
```

Reuse returns actual saved name, code and capacity without writes, including after an organizer edits these fields. It never resets registration counters or overwrites a previous capacity with a retry's input. The default has no privileged/unrestricted pricing behavior: final ticket creation uses its ordinary ID in the existing ticket-plus-fees transaction.

Before first creation, a transaction query checks `eventId ==`, `organizationId ==`, `code == GENERAL`, `limit(1)`. A different document with that code returns an actionable 409 instead of silently adopting another audience. Add the corresponding `RegistrationType(eventId ASC, organizationId ASC, code ASC)` index from `firestore.indexes.json` during normal infrastructure deployment. No list scan is used.

The deterministic identity prevents duplicates among concurrent calls to this new default endpoint. Existing generic registration-type create/update endpoints retain their previous code uniqueness behavior; this work does not redesign their pre-existing query-then-write race protection. Deleting an unused default allows a later explicit request to create it again at the same ID.

## Pause and resume

`PATCH /api/dashboard/events/{eventId}/tickets/{ticketTypeId}/sales` accepts `{ isOpen: boolean }` and returns `{ ticketTypeId, isOpen }`. It uses the same session/org/write/event gates and the existing transactionally scoped `updateAdminTicketType` DAL method. Missing or cross-event/org tickets return 404.

The route passes only `isOpen`; the DAL also stamps `updatedAt`. Name, code, capacity, counters, dates, registration type eligibility and fees are unchanged. Unknown input fields are stripped, so a stale or malicious full-ticket payload cannot overwrite them. Existing availability evaluation continues to apply sales dates and capacity even after resuming.

All Firestore calls stay inside `src/lib/db/`. Clients cannot directly write these collections under existing rules. Neither opening the wizard nor displaying a default row creates data.

## Verification

`ticket-ux-routes.test.ts` exercises the real scope resolver with mocked authentication/DAL dependencies: session, permissions, event isolation, invalid inputs, explicit allow-lists and response/error contracts. `ticket-ux-dal.test.ts` executes the real DAL against the shared fake database, covering creation, reuse after edits, tenant/event isolation, code collisions, write-set preservation and a staged conflicting-create retry. This is a transaction simulation, not an emulator/load test of Firestore's retry service.
