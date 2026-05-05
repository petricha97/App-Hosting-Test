export interface EventPageAsset {
  name: string;
  path: string;
  url: string;
  contentType: string;
  size: number;
  updatedAt: string | null;
}

export function buildEventPageAssetsPrefix(storagePrefix: string) {
  return `${storagePrefix}/assets`;
}

export function sanitizeStorageFileName(fileName: string) {
  return fileName
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();
}
