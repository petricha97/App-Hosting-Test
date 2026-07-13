"use client";

// Add-team-member dialog (M5-T4 AC-4, design §3) — TWO-PHASE:
//   phase 1 "form": Name + Device label, Cancel / Add;
//   phase 2 "code": the one-time access-code panel (font-mono, dashed
//     groups), copy button (Copy -> Check "Copied" for 2s), amber warning
//     "Save this code now — it won't be shown again." and a single Done
//     button. Focus moves to the code panel on the swap so screen readers
//     announce the credential exactly once.
// The code exists ONLY in this response — it is never retrievable again.

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SerializedTeamMember } from "@/features/checkin/utils";

interface AddTeamMemberDialogProps {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (member: SerializedTeamMember) => void;
}

type Phase =
  | { step: "form" }
  | { step: "code"; accessCode: string; memberName: string };

export function AddTeamMemberDialog({
  eventId,
  open,
  onOpenChange,
  onAdded,
}: AddTeamMemberDialogProps) {
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [name, setName] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const codePanelRef = useRef<HTMLDivElement>(null);

  // Reset per open so a reopened dialog never shows a stale code.
  useEffect(() => {
    if (open) {
      setPhase({ step: "form" });
      setName("");
      setDeviceLabel("");
      setError(null);
      setCopied(false);
    }
  }, [open]);

  useEffect(() => {
    if (phase.step === "code") codePanelRef.current?.focus();
  }, [phase.step]);

  const submit = async () => {
    if (name.trim().length === 0) {
      setError("Name is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/checkin/team-members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), deviceLabel: deviceLabel.trim() }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(data?.error ?? "Couldn't add the team member. Try again.");
        return;
      }

      const data = (await response.json()) as {
        member: SerializedTeamMember;
        accessCode: string;
      };
      onAdded(data.member);
      setPhase({
        step: "code",
        accessCode: data.accessCode,
        memberName: data.member.name,
      });
    } catch {
      setError("Couldn't add the team member. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyCode = async () => {
    if (phase.step !== "code") return;
    try {
      await navigator.clipboard.writeText(phase.accessCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — the code stays visible for manual copying.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {phase.step === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle>Add team member</DialogTitle>
              <DialogDescription>
                Staff devices scan attendee passes at the door with a one-time
                access code.
              </DialogDescription>
            </DialogHeader>

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="team-member-name">Name</Label>
                <Input
                  id="team-member-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Maria Chen"
                  maxLength={120}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-member-device">Device label</Label>
                <Input
                  id="team-member-device"
                  value={deviceLabel}
                  onChange={(event) => setDeviceLabel(event.target.value)}
                  placeholder="Door A"
                  maxLength={120}
                  disabled={submitting}
                />
              </div>

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : null}
                  Add team member
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Access code for {phase.memberName}</DialogTitle>
              <DialogDescription>
                Enter this code on the scanning device to start checking
                people in.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div
                ref={codePanelRef}
                tabIndex={-1}
                className="rounded-lg border p-4 text-center font-mono text-2xl tracking-widest break-all outline-none"
              >
                {phase.accessCode}
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void copyCode()}
              >
                {copied ? (
                  <>
                    <Check aria-hidden="true" /> Copied
                  </>
                ) : (
                  <>
                    <Copy aria-hidden="true" /> Copy code
                  </>
                )}
              </Button>
              <div className="flex items-start gap-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                Save this code now — it won&apos;t be shown again.
              </div>
            </div>

            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
