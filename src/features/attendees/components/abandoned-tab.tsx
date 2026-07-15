"use client";

// "Abandoned" tab (M5-T3 design §2, M6-T3 wiring): abandoned-draft rows
// (>24h stale only — the server already filtered), right-aligned amber count
// badge, "Email all" (M6-T3 — bulk-sends the abandoned-reminder definition,
// spec m6-lifecycle-triggers.md §7), per-row delete via the existing M3
// purge route, helper copy under the table.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Timer } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SerializedAbandonedDraft } from "@/features/attendees/abandoned";
import { AbandonedTable } from "@/features/attendees/components/abandoned-table";
import { EntityTableError } from "@/features/registration/components/entity-table-states";

interface EmailAllResponse {
  sent?: number;
  alreadyEmailed?: number;
  skippedNoEmail?: number;
  // Recipients whose draft email failed send-time validation (malformed
  // address) — pre-split out before batching (M6-T3 Security L-3) so they
  // never block the rest of the batch. Not surfaced in the toast copy below
  // (same minimal posture as skippedNoEmail) — a count-only field kept for
  // callers/response-shape completeness.
  skippedInvalidEmail?: number;
  error?: string;
}

interface AbandonedTabProps {
  eventId: string;
  drafts: SerializedAbandonedDraft[];
  onDraftsChange: (drafts: SerializedAbandonedDraft[]) => void;
  loadError: boolean;
}

export function AbandonedTab({
  eventId,
  drafts,
  onDraftsChange,
  loadError,
}: AbandonedTabProps) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Cleared once a client-side retry through the drafts route succeeds —
  // the tab recovers without waiting on the server page's refresh.
  const [recovered, setRecovered] = useState(false);
  // Client-side in-flight guard (spec §7's double-click safety rail) — the
  // server-side dedupe (dedupeKey = draftId, shared with the automatic 24h
  // trigger) is the real backstop regardless.
  const [emailingAll, setEmailingAll] = useState(false);

  const emailAll = async () => {
    if (emailingAll) return;
    setEmailingAll(true);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/drafts/email-all`,
        { method: "POST" },
      );
      const data = (await response
        .json()
        .catch(() => null)) as EmailAllResponse | null;

      if (!response.ok) {
        toast.error(data?.error ?? "Failed to email abandoned registrants.");
        return;
      }

      const sent = data?.sent ?? 0;
      const alreadyEmailed = data?.alreadyEmailed ?? 0;
      if (sent === 0 && alreadyEmailed > 0) {
        toast.success(
          alreadyEmailed === 1
            ? "Already emailed — nothing new to send"
            : `Already emailed everyone (${alreadyEmailed})`,
        );
      } else if (alreadyEmailed > 0) {
        toast.success(`${sent} sent, ${alreadyEmailed} already emailed`);
      } else {
        toast.success(sent === 1 ? "1 email sent" : `${sent} emails sent`);
      }
    } catch {
      toast.error("Failed to email abandoned registrants.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setEmailingAll(false);
    }
  };

  // Error retry: re-fetch through the drafts list route (masked server-side)
  // without a full page reload; router.refresh() re-syncs the server page.
  const retry = async () => {
    setRetrying(true);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/drafts`,
      );
      if (!response.ok) {
        toast.error("Failed to load abandoned registrations.");
        return;
      }
      const data = (await response.json()) as {
        drafts: SerializedAbandonedDraft[];
      };
      onDraftsChange(data.drafts);
      setRecovered(true);
      router.refresh();
    } catch {
      toast.error("Failed to load abandoned registrations.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setRetrying(false);
    }
  };

  const deleteDraft = async (draft: SerializedAbandonedDraft) => {
    setDeletingId(draft.id);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/drafts/${encodeURIComponent(draft.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        toast.error("Failed to delete the draft.");
        return;
      }
      onDraftsChange(drafts.filter((row) => row.id !== draft.id));
      toast.success("Draft deleted");
    } catch {
      toast.error("Failed to delete the draft.", {
        description: "Check your connection and try again.",
      });
    } finally {
      setDeletingId(null);
    }
  };

  if (loadError && !recovered) {
    return (
      <EntityTableError
        entityLabel="abandoned registrations"
        onRetry={() => void retry()}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <span className="flex-1" />
          <span aria-live="polite">
            <Badge className="rounded-full bg-amber-100 text-amber-900 tabular-nums dark:bg-amber-950 dark:text-amber-200">
              {drafts.length} abandoned
            </Badge>
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={emailingAll || drafts.length === 0}
            onClick={() => void emailAll()}
          >
            {emailingAll ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Mail aria-hidden="true" />
            )}
            Email all
          </Button>
          {retrying ? (
            <Loader2
              aria-hidden="true"
              className="h-4 w-4 animate-spin text-muted-foreground"
            />
          ) : null}
        </div>

        {drafts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Timer aria-hidden="true" className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              No abandoned registrations
            </p>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Registrations idle for more than 24 hours land here.
            </p>
          </div>
        ) : (
          <AbandonedTable
            drafts={drafts}
            deletingId={deletingId}
            onDelete={(draft) => void deleteDraft(draft)}
          />
        )}
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Knowing the last page reached tells you whether to nudge on info, ticket
        choice, or payment.
      </p>
    </div>
  );
}
