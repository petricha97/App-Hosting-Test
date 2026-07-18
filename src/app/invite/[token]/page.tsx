// Public invite-accept page (M8-T1 spec §4) — /invite/{token}, the URL
// InviteMemberDialog's "sent" view generates and copies
// (src/app/api/dashboard/iam/invites/route.ts buildAcceptUrl). The invitee
// is not yet a member of the target org, so this is a top-level route, not
// under /dashboard. All the actual state handling (loading / not-signed-in
// / accepting / success / EMAIL_MISMATCH / invalid) lives client-side in
// AcceptInvitationView since it depends on the visitor's live Firebase auth
// state, which cannot be resolved server-side from this page alone.
import type { Metadata } from "next";

import { AcceptInvitationView } from "@/features/iam/components/accept-invitation-view";

export const metadata: Metadata = {
  title: "Accept invitation | Eventa",
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function InviteTokenPage({ params }: PageProps) {
  const { token } = await params;
  return <AcceptInvitationView token={token} />;
}
