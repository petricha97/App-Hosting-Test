import { redirect } from "next/navigation";

interface PageProps {
    searchParams: Promise<{ code?: string; token?: string }>;
}

export default async function SignupPage({ searchParams }: PageProps) {
    const { code } = await searchParams;
    redirect(`/signup/credentials${code ? `?code=${code}` : ""}`);
}
