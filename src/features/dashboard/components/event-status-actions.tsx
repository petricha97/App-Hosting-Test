"use client";

import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface EventStatusActionsProps {
  eventId: string;
  status: "Draft" | "Published";
}

export function EventStatusActions({
  eventId,
  status,
}: EventStatusActionsProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const nextStatus = status === "Published" ? "Draft" : "Published";

  async function handleToggleStatus() {
    try {
      setIsSaving(true);

      const response = await fetch(`/api/dashboard/events/${eventId}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      const payload = (await response.json()) as {
        error?: string;
        status?: "Draft" | "Published";
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update event status");
      }

      toast.success(
        nextStatus === "Published" ? "Event published" : "Event moved to draft",
        {
          description:
            nextStatus === "Published"
              ? "The event can now appear in the public events list."
              : "The event is now hidden from the public events list.",
        },
      );

      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("Unable to update event status", {
        description:
          error instanceof Error
            ? error.message
            : "Please try again in a moment.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Button
        type="button"
        variant={status === "Published" ? "outline" : "default"}
        onClick={handleToggleStatus}
        disabled={isSaving}
      >
        {isSaving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Updating status
          </>
        ) : status === "Published" ? (
          <>
            <EyeOff className="mr-2 h-4 w-4" />
            Move to draft
          </>
        ) : (
          <>
            <Eye className="mr-2 h-4 w-4" />
            Publish event
          </>
        )}
      </Button>

      {status === "Published" ? (
        <Button asChild variant="outline">
          <a href={`/events/${eventId}`} target="_blank" rel="noreferrer">
            View public page
          </a>
        </Button>
      ) : null}
    </div>
  );
}
