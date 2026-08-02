import type { AssetProvider } from "@/types/collection";

export interface AssetBlobUploadInput {
  organizationId: string;
  assetId: string;
  originalName: string;
  contentType: string;
  buffer: Buffer;
}

export interface AssetBlobUploadResult {
  blobKey: string;
  downloadToken: string;
  provider: AssetProvider;
}

export interface AssetBlobStore {
  upload(input: AssetBlobUploadInput): Promise<AssetBlobUploadResult>;
  delete(blobKey: string): Promise<void>;
  getDownloadUrl(blobKey: string, downloadToken: string): string;
}

import { firebaseAssetBlobStore } from "@/lib/assets/providers/firebase-blob-store";

export function getAssetBlobStore(): AssetBlobStore {
  return firebaseAssetBlobStore;
}
