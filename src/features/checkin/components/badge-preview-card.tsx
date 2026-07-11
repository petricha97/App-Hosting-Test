// Badge & pass design preview (M5-T4 AC-2, design §3): a live sample from
// the FIRST accepted attendee (real decodable QR SVG + merge-field denorms)
// or the "Sample Attendee" placeholder when the roster is empty. The whole
// preview is decorative on this admin surface (role="presentation", QR
// aria-hidden) — the attendee-facing confirmation QR is the content copy.

import { QrCode } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface BadgeSample {
  fullName: string;
  jobTitle: string;
  company: string;
  registrationTypeLabel: string;
  // Server-rendered SVG markup for the attendee's real QR token; null for
  // the zero-attendee placeholder (renders a muted glyph instead).
  qrSvg: string | null;
}

export const SAMPLE_BADGE: BadgeSample = {
  fullName: "Sample Attendee",
  jobTitle: "Job title",
  company: "Company",
  registrationTypeLabel: "Registration type",
  qrSvg: null,
};

export function BadgePreviewCard({ sample }: { sample: BadgeSample }) {
  const detail = [sample.jobTitle, sample.company]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Badge &amp; pass design</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-6">
        <div role="presentation" className="rounded-lg border p-6 text-center">
          <div className="mx-auto flex aspect-[2/3] w-56 flex-col items-center justify-center gap-3">
            {sample.qrSvg ? (
              <div
                aria-hidden="true"
                data-testid="badge-preview-qr"
                className="h-28 w-28 rounded-lg bg-white p-2 [&_svg]:h-full [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: sample.qrSvg }}
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-28 w-28 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              >
                <QrCode className="h-12 w-12" />
              </div>
            )}
            <p className="text-lg font-semibold">{sample.fullName}</p>
            {detail ? (
              <p className="text-sm text-muted-foreground">{detail}</p>
            ) : null}
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-900 dark:bg-violet-950 dark:text-violet-200">
              {sample.registrationTypeLabel}
            </span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Merge fields:{" "}
          <span className="font-mono">
            {"{full_name}"}, {"{job_title}"}, {"{company}"}
          </span>{" "}
          + QR. Stock: 6&quot;×4&quot; double-sided.
        </p>
      </CardContent>
    </Card>
  );
}
