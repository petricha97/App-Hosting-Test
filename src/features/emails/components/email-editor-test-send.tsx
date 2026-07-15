"use client";

// The editor's "Send test" affordance (design §5) — a custom hook owning the
// recipient form/pending/result state and the fetch call, plus two
// presentational pieces that render at their original JSX positions inside
// EmailEditorDialog: the inline recipient row (above the footer) and the
// trigger button (in the footer's left slot). Split out of
// email-editor-dialog.tsx (S-1, M6-T2 code review) — pure extraction, no
// behavior change; the hook's own open/definition-keyed reset effect
// reproduces exactly what the dialog's single reset effect did before the
// split.
import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Send } from "lucide-react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  testSendFormSchema,
  type TestSendFormValues,
} from "@/features/emails/schemas";
import type { SerializedEmailDefinition } from "@/features/emails/types";

export interface EmailEditorTestSendState {
  testSendOpen: boolean;
  setTestSendOpen: (open: boolean) => void;
  testSendPending: boolean;
  testSendResult: string | null;
  testSendForm: UseFormReturn<TestSendFormValues>;
  handleTestSend: (values: TestSendFormValues) => Promise<void>;
}

export function useEmailEditorTestSend(
  eventId: string,
  definition: SerializedEmailDefinition | null,
  open: boolean,
): EmailEditorTestSendState {
  const testSendForm = useForm<TestSendFormValues>({
    resolver: zodResolver(testSendFormSchema),
    defaultValues: { recipientEmail: "" },
  });

  const [testSendOpen, setTestSendOpen] = useState(false);
  const [testSendPending, setTestSendPending] = useState(false);
  const [testSendResult, setTestSendResult] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      testSendForm.reset({ recipientEmail: "" });
      setTestSendOpen(false);
      setTestSendResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, definition]);

  const handleTestSend = async (values: TestSendFormValues) => {
    if (!definition) return;
    setTestSendPending(true);
    try {
      const response = await fetch(
        `/api/dashboard/events/${encodeURIComponent(eventId)}/emails/test-send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: definition.kind,
            recipientEmail: values.recipientEmail,
          }),
        },
      );
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        testSendForm.setError("recipientEmail", {
          type: "server",
          message:
            typeof data?.error === "string"
              ? data.error
              : "Failed to send the test email.",
        });
        return;
      }

      toast.success("Test email sent");
      setTestSendResult(`Test sent to ${values.recipientEmail} just now`);
      setTestSendOpen(false);
      testSendForm.reset({ recipientEmail: "" });
    } catch {
      testSendForm.setError("recipientEmail", {
        type: "server",
        message: "Check your connection and try again.",
      });
    } finally {
      setTestSendPending(false);
    }
  };

  return {
    testSendOpen,
    setTestSendOpen,
    testSendPending,
    testSendResult,
    testSendForm,
    handleTestSend,
  };
}

interface EmailEditorTestSendRowProps {
  state: EmailEditorTestSendState;
}

// The inline recipient-email row — renders only while `testSendOpen`, else
// the last result line (if any). Sits above the dialog footer.
export function EmailEditorTestSendRow({ state }: EmailEditorTestSendRowProps) {
  const {
    testSendOpen,
    testSendResult,
    testSendPending,
    testSendForm,
    handleTestSend,
  } = state;

  return (
    <div className="space-y-2">
      {testSendOpen ? (
        <Form {...testSendForm}>
          <form
            onSubmit={testSendForm.handleSubmit(handleTestSend)}
            className="flex flex-wrap items-start gap-2"
          >
            <FormField
              control={testSendForm.control}
              name="recipientEmail"
              render={({ field }) => (
                <FormItem className="min-w-56 flex-1">
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" size="sm" disabled={testSendPending}>
              {testSendPending ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : null}
              Send
            </Button>
          </form>
        </Form>
      ) : testSendResult ? (
        <p className="text-xs text-muted-foreground">{testSendResult}</p>
      ) : null}
    </div>
  );
}

interface EmailEditorTestSendButtonProps {
  state: EmailEditorTestSendState;
  enabled: boolean;
  isCreate: boolean;
}

// The footer's "Send test" trigger (or its disabled/tooltip variant when the
// definition is off) — hidden once the row above is open.
export function EmailEditorTestSendButton({
  state,
  enabled,
  isCreate,
}: EmailEditorTestSendButtonProps) {
  const { testSendOpen, setTestSendOpen } = state;

  if (testSendOpen) return null;

  if (!enabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button type="button" variant="outline" size="sm" disabled>
              <Send aria-hidden="true" />
              Send test
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          This email is off — turn it on to send a test
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isCreate}
      onClick={() => setTestSendOpen(true)}
    >
      <Send aria-hidden="true" />
      Send test
    </Button>
  );
}
