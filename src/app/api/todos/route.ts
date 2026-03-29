import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";

import { adminAuth } from "@/app/lib/firestore";
import { createTodo } from "@/lib/db/db";

const CreateTodoSchema = z.object({
    title: z.string().min(1, "Title cannot be empty"),
});

function getBearerToken(req: Request) {
    const h = req.headers.get("authorization");
    if (!h?.startsWith("Bearer ")) return null;
    return h.slice("Bearer ".length);
}

export async function POST(req: Request) {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);

    const body = await req.json();
    const parsed = CreateTodoSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const id = await createTodo({
        uid: decoded.uid,
        title: parsed.data.title,
        completed: false,
        createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id });
}
