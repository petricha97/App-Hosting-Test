import { CredentialsForm } from "@/features/signup/components/credentials-form";

interface PageProps {
    searchParams: Promise<{ code?: string }>;
}

export default async function CredentialsPage({ searchParams }: PageProps) {
    const { code } = await searchParams;
    return <CredentialsForm prefilledCode={code} />;
}
