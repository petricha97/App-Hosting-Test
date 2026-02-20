import { SignupWizard } from "@/components/auth/signup-wizard";

interface PageProps {
  searchParams: Promise<{ code?: string; token?: string }>;
}

export default async function SignupPage({ searchParams }: PageProps) {
  const params = await searchParams;
  return (
    <SignupWizard
      inviteCode={params.code}
      inviteToken={params.token}
    />
  );
}
