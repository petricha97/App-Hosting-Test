import { CredentialsForm } from "@/features/signup/components/credentials-form";

interface PageProps {
  searchParams: Promise<{ code?: string; inviteToken?: string }>;
}

export default async function CredentialsPage({ searchParams }: PageProps) {
  const { code, inviteToken } = await searchParams;
  return (
    <CredentialsForm prefilledCode={code} prefilledInviteToken={inviteToken} />
  );
}
