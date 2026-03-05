import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth, adminDb } from "@/app/lib/firestore";

const COOKIE_NAME = "session";

export default async function DashboardPage() {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    // Option A: redirect if not logged in
    if (!token) redirect("/login");

    let decoded;

    try {
        decoded = await adminAuth.verifyIdToken(token);
    } catch {
        redirect("/login");
    }

    const email = decoded.email ?? "No email";

    return (
        <div className="p-6 space-y-4">
            <h1 className="text-2xl font-bold">Dashboard</h1>

            <div className="text-sm text-muted-foreground">
                Signed in as <span className="font-medium">{email}</span>
            </div>
        </div>
    );
}