import { NextResponse } from "next/server";

import { adminAuth, adminDb } from "@/app/lib/firestore";

function getBearerToken(req: Request) {
    const h = req.headers.get("authorization");
    if (!h?.startsWith("Bearer ")) return null;
    return h.slice("Bearer ".length);
}

export async function POST(req: Request) {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    const { title } = await req.json();
    
    const ref = await adminDb.collection("todos").add({
        uid: decoded.uid,
        title,
        completed: false,
        createdAt: new Date(),
    });

    return NextResponse.json({ id: ref.id });
}