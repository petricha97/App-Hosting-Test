import { redirect } from "next/navigation";

interface PageProps {
  // inviteToken mirrors code's shape (M8-T1 §4) — carries a per-email
  // invitation token forward through the wizard's first step.
  searchParams: Promise<{ code?: string; inviteToken?: string }>;
}

export default async function SignupPage({ searchParams }: PageProps) {
  const { code, inviteToken } = await searchParams;
  const params = new URLSearchParams();
  if (code) params.set("code", code);
  if (inviteToken) params.set("inviteToken", inviteToken);
  const query = params.toString();
  redirect(`/signup/credentials${query ? `?${query}` : ""}`);
}
