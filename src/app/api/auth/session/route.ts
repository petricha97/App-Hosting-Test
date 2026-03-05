import { NextResponse } from "next/server";
import { adminAuth } from "@/app/lib/firestore"; // your Admin SDK export

const COOKIE_NAME = "session";

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  // Verify the token is legit before setting cookie
  try {
    await adminAuth.verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });

  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    // optional: keep it short so it refreshes often
    maxAge: 60 * 60 * 24, // 1 day
  });

  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}