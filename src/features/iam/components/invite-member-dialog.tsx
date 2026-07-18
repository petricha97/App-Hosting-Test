"use client";

// Invite dialog (design §2) — two internal views ("form" | "sent") mirroring
// report-schedules-dialog.tsx's view state-machine idiom. D8: no real email
// delivery — the "sent" view is a copy-the-accept-link UX, reusing
// add-team-member-dialog.tsx's exact clipboard pattern.
import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RoleBadge } from "@/features/iam/components/role-badge";
import { invitableRoles, roleLabel } from "@/features/iam/permissions";
import type {
  InvitableRole,
  InvitationRow,
  OrgRole,
} from "@/features/iam/types";

const inviteFormSchema = z.object({
  email: z.email("Enter a valid email."),
  role: z.enum(["admin", "editor", "viewer"]),
});

type InviteFormValues = z.infer<typeof inviteFormSchema>;

interface SentState {
  email: string;
  role: InvitableRole;
  acceptUrl: string;
  wasExisting: boolean;
}

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  callerRole: OrgRole;
  onInvited: (invitation: InvitationRow) => void;
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  callerRole,
  onInvited,
}: InviteMemberDialogProps) {
  const [view, setView] = useState<"form" | "sent">("form");
  const [sent, setSent] = useState<SentState | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: "", role: "viewer" },
  });
  const { isSubmitting } = form.formState;

  useEffect(() => {
    if (open) {
      setView("form");
      setSent(null);
      setCopied(false);
      form.reset({ email: "", role: "viewer" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const roleOptions = invitableRoles(callerRole);

  const onSubmit = async (values: InviteFormValues) => {
    try {
      const response = await fetch("/api/dashboard/iam/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          field?: "email";
        } | null;
        if (data?.field === "email") {
          form.setError("email", {
            type: "server",
            message:
              data.error ??
              "This person is already a member of this workspace.",
          });
          return;
        }
        if (response.status === 403) {
          toast.error("You don't have permission to do that.");
          return;
        }
        toast.error(data?.error ?? "Couldn't send the invite. Try again.");
        return;
      }

      const data = (await response.json()) as {
        invitation: InvitationRow;
        acceptUrl: string;
        wasExisting: boolean;
      };
      setSent({
        email: data.invitation.email,
        role: data.invitation.role,
        acceptUrl: data.acceptUrl,
        wasExisting: data.wasExisting,
      });
      setView("sent");
    } catch {
      toast.error("Failed to send the invite.", {
        description: "Check your connection and try again.",
      });
    }
  };

  const copyLink = async () => {
    if (!sent) return;
    try {
      await navigator.clipboard.writeText(sent.acceptUrl);
      setCopied(true);
      toast.success("Invite link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — the link stays visible for manual copying.
    }
  };

  const done = () => {
    if (sent) {
      onInvited({
        email: sent.email,
        role: sent.role,
        status: "invited",
        invitedAt: Date.now(),
        expiresAt: null,
        invitedBy: "",
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {view === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle>Invite a teammate</DialogTitle>
              <DialogDescription>
                They&apos;ll get a link to join this workspace at the role you
                choose.
              </DialogDescription>
            </DialogHeader>

            <Form {...form}>
              <form
                className="space-y-4"
                onSubmit={form.handleSubmit(onSubmit)}
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email address</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="teammate@company.com"
                          disabled={isSubmitting}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={isSubmitting}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {roleOptions.map((role) => (
                            <SelectItem key={role} value={role}>
                              {roleLabel(role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {callerRole === "admin" ? (
                        <FormDescription>
                          Only an Owner can invite someone as Admin.
                        </FormDescription>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : null}
                    Send invite
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        ) : sent ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {sent.wasExisting ? "Invite updated" : "Invite sent"}
              </DialogTitle>
              <DialogDescription>
                {sent.wasExisting
                  ? `The role and link were refreshed for ${sent.email}.`
                  : `Share this link with ${sent.email} — it expires in 14 days.`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={sent.acceptUrl}
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy invite link"
                  onClick={() => void copyLink()}
                >
                  {copied ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <RoleBadge role={sent.role} />
                <span className="text-sm text-muted-foreground">
                  Role: {roleLabel(sent.role)}
                </span>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" onClick={done}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
