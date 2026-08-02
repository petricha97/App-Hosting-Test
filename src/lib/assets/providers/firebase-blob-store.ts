import "server-only";

import { randomUUID } from "node:crypto";

import { adminStorage } from "@/app/lib/firestore";
import type {
  AssetBlobStore,
  AssetBlobUploadInput,
  AssetBlobUploadResult,
} from "@/lib/assets/blob-store";

function getBucket() {
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  return bucketName ? adminStorage.bucket(bucketName) : adminStorage.bucket();
}

function sanitizeStorageFileName(fileName: string) {
  return fileName
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export class FirebaseAssetBlobStore implements AssetBlobStore {
  async upload(input: AssetBlobUploadInput): Promise<AssetBlobUploadResult> {
    const bucket = getBucket();
    const safeName = sanitizeStorageFileName(input.originalName || "asset");
    const fileName = safeName || "asset";
    const blobKey = `organizations/${input.organizationId}/assets/files/${input.assetId}/${fileName}`;
    const downloadToken = randomUUID();
    const file = bucket.file(blobKey);

    await file.save(input.buffer, {
      resumable: false,
      contentType: input.contentType || "application/octet-stream",
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    return {
      blobKey,
      downloadToken,
      provider: "firebase-storage",
    };
  }

  async delete(blobKey: string) {
    const bucket = getBucket();
    await bucket.file(blobKey).delete({ ignoreNotFound: true });
  }

  getDownloadUrl(blobKey: string, downloadToken: string) {
    const bucket = getBucket();

    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
      blobKey,
    )}?alt=media&token=${downloadToken}`;
  }
}

export const firebaseAssetBlobStore = new FirebaseAssetBlobStore();
