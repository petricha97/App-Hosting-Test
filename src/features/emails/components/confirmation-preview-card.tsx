"use client";

// Confirmation email preview card (design §4, prototype right column) — the
// `confirmation-paid` definition rendered through the SAME server-side
// pipeline as the editor preview (§3 AC-3 "one preview implementation").
// Wallet badges are Q4 visual placeholders — no click handler at all.
import { QrCode } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EmailPreviewFrame } from "@/features/emails/components/email-preview-frame";
import type { RenderedEmailPreview } from "@/features/emails/types";

interface ConfirmationPreviewCardProps {
  preview:
    | (RenderedEmailPreview & { qrSvg: string | null; isRealAttendee: boolean })
    | null;
  loadError: boolean;
  onEdit: () => void;
  title?: string;
  showEditLink?: boolean;
}

export function ConfirmationPreviewCard({
  preview,
  loadError,
  onEdit,
  title = "What the attendee will see",
  showEditLink = true,
}: ConfirmationPreviewCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load the preview. Reload the page to try again.
          </p>
        ) : !preview ? (
          <div className="space-y-2">
            <Skeleton className="h-72 w-full rounded-lg" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <>
            <EmailPreviewFrame
              subject={preview.subject}
              bodyHtml={preview.bodyHtml}
              missingTags={preview.missingTags}
              unknownTags={preview.unknownTags}
              unknownVariables={preview.unknownVariables ?? []}
            />

            <div className="flex items-center gap-4">
              {preview.qrSvg ? (
                <div
                  aria-hidden="true"
                  className="h-16 w-16 rounded-lg bg-white p-1 [&_svg]:h-full [&_svg]:w-full"
                  // L-6 invariant: this is TRUSTED, server-minted SVG markup
                  // (never user input) — the raw QR token appears nowhere in
                  // the DOM outside this SVG geometry (M5-T1 AC-6 carry-over).
                  dangerouslySetInnerHTML={{ __html: preview.qrSvg }}
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                >
                  <QrCode className="h-8 w-8" />
                </div>
              )}
              <div>
                <p className="text-sm font-medium">Delegate check-in QR</p>
                <p className="text-xs text-muted-foreground">
                  {preview.isRealAttendee
                    ? "Present at check-in."
                    : "Sample QR — no attendees yet."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Badge variant="outline">Add to Apple Wallet</Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Wallet passes aren&apos;t generated yet
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Badge variant="outline">Add to Google Wallet</Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Wallet passes aren&apos;t generated yet
                </TooltipContent>
              </Tooltip>
            </div>
          </>
        )}

        {showEditLink ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={onEdit}
          >
            Edit this email
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
