// Client-safe wire types for the M6-T2 emails screen — everything the
// server page / API routes hand to the client components is serialized
// through these shapes (no Firestore Timestamp ever crosses the boundary).
// PURE module — no Firebase, no server imports (safe for client components).
import type {
  EmailDefinitionAudience,
  EmailDefinitionGroup,
  EmailMessageStatus,
} from "@/types/collection";

export type SerializedEmailDefinitionTrigger =
  | { type: "manual" }
  | { type: "on-submit" }
  | { type: "on-accept" }
  | { type: "abandoned-24h" }
  | { type: "unpaid-offsets"; offsetsDays: number[] }
  | { type: "scheduled"; atMs: number | null };

// One row of the merged (virtual-default + stored) list — the shape both
// email-group-table.tsx and email-editor-dialog.tsx consume. `id` is the
// deterministic definitionId (computable whether or not a doc exists yet —
// spec §2 "definitionId on outbox rows is computable... whether or not the
// doc exists"); `materialized` is display-only (never gates editability —
// isSystem does that).
export interface SerializedEmailDefinition {
  id: string;
  kind: string;
  name: string;
  group: EmailDefinitionGroup;
  trigger: SerializedEmailDefinitionTrigger;
  audience: EmailDefinitionAudience;
  enabled: boolean;
  subject: string;
  body: string;
  isSystem: boolean;
  sortOrder: number;
  materialized: boolean;
  createdAtMs: number | null;
}

export interface SerializedEmailRecipient {
  name: string;
  email: string;
}

export interface SerializedEmailLastError {
  message: string;
  atMs: number | null;
}

export interface SerializedEmailMessage {
  id: string;
  kind: string;
  definitionId: string | null;
  recipient: SerializedEmailRecipient;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  status: EmailMessageStatus;
  attemptCount: number;
  lastError: SerializedEmailLastError | null;
  providerMessageId: string | null;
  queuedAtMs: number | null;
  sentAtMs: number | null;
  failedAtMs: number | null;
  createdAtMs: number | null;
}

export interface SerializedEmailSettings {
  fromName: string;
  fromAddress: string;
  replyTo: string | null;
  // "settings" = a stored EmailSettings doc backs these values; "defaults" =
  // read-time resolution, nothing stored (design §6 "Platform default" hint).
  source: "settings" | "defaults";
  hasStoredDoc: boolean;
}

export interface RenderedEmailPreview {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  missingTags: string[];
  unknownTags: string[];
}
