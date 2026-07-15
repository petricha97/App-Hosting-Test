// Converts the WIRE trigger shape (SerializedEmailDefinitionTrigger —
// `{ type: "scheduled", atMs: number | null }`, JSON-safe) into the shape
// emailDefinitionTriggerSchema expects (`{ type: "scheduled", at: Date |
// null }` — z.date() requires an actual Date instance, which JSON.parse
// never produces). Used by the definitions POST/PATCH routes before
// handing the request body to Zod.
import "server-only";

export function wireTriggerToSchemaInput(trigger: unknown): unknown {
  if (
    trigger === null ||
    typeof trigger !== "object" ||
    (trigger as { type?: unknown }).type !== "scheduled"
  ) {
    return trigger;
  }

  const atMs = (trigger as { atMs?: unknown }).atMs;
  const atMsNumber = typeof atMs === "number" ? atMs : Number(atMs);

  return {
    type: "scheduled",
    at:
      atMs === null || atMs === undefined || !Number.isFinite(atMsNumber)
        ? null
        : new Date(atMsNumber),
  };
}
