import EventFormTest from "@/features/event/event-form-test";
import decodeUser from "@/lib/auth-utils";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";


const COOKIE_NAME = "session";




export default async function DashboardPage() {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) redirect("/login");

    const user = await decodeUser(token);

    if ("error" in user) {
        if (user.error === "USER_DISABLED") redirect("/disabled");
        if (user.error === "TOKEN_EXPIRED") redirect("/login");

        redirect("/login");
    }

    const email = user.email;
    const uid = user.uid;
    const name = user.name;
    const picture = user.picture;

    return (
        <div className="p-6 space-y-4">
            <h1 className="text-2xl font-bold">Dashboard</h1>

            <div className="text-sm text-muted-foreground">
                Signed in as <span className="font-medium">{email}</span>
            </div>
            <div className="text-sm text-muted-foreground">
                Signed in as <span className="font-medium">{uid}</span>
            </div>
            <div className="text-sm text-muted-foreground">
                Signed in as <span className="font-medium">{name}</span>
            </div>
            <div className="text-sm text-muted-foreground">
                Signed in as <span className="font-medium">{picture}</span>
            </div>
            <EventFormTest/>
        </div>
    );
}