// POST /api/dashboard/settings/organization/logo
// Accepts a multipart/form-data file upload, saves it to Firebase Storage under
// organizations/{orgId}/logo, then writes the download URL to OrganizationDoc.logoUrl.
// Requires write:organization permission.
import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import decodeUser from "@/lib/auth-utils";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import { updateAdminOrganization } from "@/lib/db/adminOrganization";
import { adminStorage } from "@/app/lib/firestore";

const COOKIE_NAME = "session";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function getBucket() {
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  return bucketName ? adminStorage.bucket(bucketName) : adminStorage.bucket();
}

function buildDownloadUrl(bucketName: string, path: string, token: string) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: "Missing session" }, { status: 401 });
    }

    const decodedUser = await decodeUser(token);
    if ("error" in decodedUser) {
      return NextResponse.json({ error: decodedUser.error }, { status: 401 });
    }

    const userDoc = await getAdminUserByEmail(decodedUser.email.toLowerCase());
    if (!userDoc?.organizationId) {
      return NextResponse.json(
        { error: "Missing organization scope" },
        { status: 403 },
      );
    }
    if (!userDoc.permissions.includes("write:organization")) {
      return NextResponse.json(
        { error: "Missing write:organization permission" },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file upload" },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: "Uploaded file is empty" },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File exceeds 2 MB limit" },
        { status: 400 },
      );
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, WebP, and GIF are allowed" },
        { status: 400 },
      );
    }

    const ext = file.type.split("/")[1] ?? "jpg";
    const objectPath = `organizations/${userDoc.organizationId}/logo.${ext}`;
    const downloadToken = randomUUID();

    const bucket = getBucket();
    const bucketFile = bucket.file(objectPath);
    const buffer = Buffer.from(await file.arrayBuffer());

    await bucketFile.save(buffer, {
      resumable: false,
      contentType: file.type,
      metadata: {
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });

    const logoUrl = buildDownloadUrl(bucket.name, objectPath, downloadToken);

    await updateAdminOrganization(userDoc.organizationId, {
      logoUrl,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ logoUrl });
  } catch (err) {
    console.error("[org-logo] upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
