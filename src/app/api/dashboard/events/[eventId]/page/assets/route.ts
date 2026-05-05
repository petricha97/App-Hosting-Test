import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import decodeUser from "@/lib/auth-utils";
import { adminStorage } from "@/app/lib/firestore";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminEventPageForEvent } from "@/lib/db/adminEventPage";
import { getAdminUserByEmail } from "@/lib/db/adminUser";
import {
  type EventPageAsset,
  buildEventPageAssetsPrefix,
  sanitizeStorageFileName,
} from "@/features/event-pages/assets";
import { buildEventPageStoragePrefix } from "@/features/event-pages/utils";

const COOKIE_NAME = "session";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

async function getScopedEvent(eventId: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    return { error: "Missing session", status: 401 } as const;
  }

  const decodedUser = await decodeUser(token);

  if ("error" in decodedUser) {
    return { error: decodedUser.error, status: 401 } as const;
  }

  const userDoc = await getAdminUserByEmail(decodedUser.email.toLowerCase());

  if (!userDoc?.organizationId) {
    return { error: "Missing organization scope", status: 403 } as const;
  }

  if (!userDoc.permissions.includes("write:events")) {
    return { error: "Missing write:events permission", status: 403 } as const;
  }

  const event = await getAdminEventForOrganization(eventId, userDoc.organizationId);

  if (!event) {
    return { error: "Event not found", status: 404 } as const;
  }

  return {
    userDoc,
    event,
  } as const;
}

function getBucket() {
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  return bucketName ? adminStorage.bucket(bucketName) : adminStorage.bucket();
}

function buildDownloadUrl(bucketName: string, path: string, token: string) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
    path,
  )}?alt=media&token=${token}`;
}

async function ensureAssetWithUrl(path: string): Promise<EventPageAsset | null> {
  const bucket = getBucket();
  const file = bucket.file(path);
  const [exists] = await file.exists();

  if (!exists) {
    return null;
  }

  let [metadata] = await file.getMetadata();
  const tokenValue = metadata.metadata?.firebaseStorageDownloadTokens;
  let token =
    typeof tokenValue === "string" && tokenValue.trim().length > 0
      ? tokenValue
      : null;

  if (!token) {
    token = randomUUID();
    await file.setMetadata({
      metadata: {
        ...(metadata.metadata ?? {}),
        firebaseStorageDownloadTokens: token,
      },
    });
    [metadata] = await file.getMetadata();
  }

  return {
    name: path.split("/").pop() ?? path,
    path,
    url: buildDownloadUrl(bucket.name, path, token),
    contentType: metadata.contentType ?? "application/octet-stream",
    size: Number(metadata.size ?? 0),
    updatedAt: metadata.updated ?? null,
  };
}

export async function GET(_: Request, context: RouteContext) {
  try {
    const { eventId } = await context.params;
    const scoped = await getScopedEvent(eventId);

    if ("error" in scoped) {
      return NextResponse.json({ error: scoped.error }, { status: scoped.status });
    }

    const eventPage = await getAdminEventPageForEvent({
      eventId,
      organizationId: scoped.userDoc.organizationId,
      eventPagePath: scoped.event.eventPagePath,
    });

    const storagePrefix =
      eventPage?.storagePrefix ??
      buildEventPageStoragePrefix(scoped.userDoc.organizationId, eventId);
    const assetPrefix = buildEventPageAssetsPrefix(storagePrefix);

    const bucket = getBucket();
    const [files] = await bucket.getFiles({ prefix: assetPrefix });

    const assets = (
      await Promise.all(
        files
          .filter((file) => !file.name.endsWith("/"))
          .map((file) => ensureAssetWithUrl(file.name)),
      )
    ).filter((asset): asset is EventPageAsset => asset !== null);

    return NextResponse.json({ assets, storagePrefix });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to list page assets",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { eventId } = await context.params;
    const scoped = await getScopedEvent(eventId);

    if ("error" in scoped) {
      return NextResponse.json({ error: scoped.error }, { status: scoped.status });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file upload" }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "Uploaded file is empty" }, { status: 400 });
    }

    const eventPage = await getAdminEventPageForEvent({
      eventId,
      organizationId: scoped.userDoc.organizationId,
      eventPagePath: scoped.event.eventPagePath,
    });

    const storagePrefix =
      eventPage?.storagePrefix ??
      buildEventPageStoragePrefix(scoped.userDoc.organizationId, eventId);
    const assetPrefix = buildEventPageAssetsPrefix(storagePrefix);
    const safeName = sanitizeStorageFileName(file.name || "upload");
    const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName || "asset"}`;
    const objectPath = `${assetPrefix}/${fileName}`;

    const bucket = getBucket();
    const bucketFile = bucket.file(objectPath);
    const buffer = Buffer.from(await file.arrayBuffer());
    const token = randomUUID();

    await bucketFile.save(buffer, {
      resumable: false,
      contentType: file.type || "application/octet-stream",
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    const asset: EventPageAsset = {
      name: file.name,
      path: objectPath,
      url: buildDownloadUrl(bucket.name, objectPath, token),
      contentType: file.type || "application/octet-stream",
      size: file.size,
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json({ asset, storagePrefix });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to upload page asset",
      },
      { status: 500 },
    );
  }
}
