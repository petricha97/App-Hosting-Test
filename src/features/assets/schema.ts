import type { FieldValue, Timestamp } from "firebase/firestore";
import { z } from "zod";

export const ASSET_NAME_MAX_LENGTH = 120;
export const ASSET_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ASSET_MAX_PDF_BYTES = 25 * 1024 * 1024;
export const ASSET_ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);
export const ASSET_ALLOWED_FILE_TYPES = new Set([
  ...ASSET_ALLOWED_IMAGE_TYPES,
  "application/pdf",
]);

const firestoreTimestampSchema = z.custom<Timestamp | FieldValue>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    ("seconds" in value ||
      typeof (value as { toDate?: unknown }).toDate === "function"),
  "Expected a Firestore timestamp-like value",
);

export function normalizeAssetNodeName(input: string) {
  return input.trim().replace(/\s+/g, " ");
}

export function normalizeAssetNameForUniqueness(input: string) {
  return normalizeAssetNodeName(input).toLowerCase();
}

export const assetNodeNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(ASSET_NAME_MAX_LENGTH, "Name is too long")
  .transform(normalizeAssetNodeName)
  .refine(
    (value) => !/[\\/]/.test(value),
    "Names cannot contain slashes",
  );

export const assetParentIdSchema = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional()
  .transform((value) => value ?? null);

export const assetFolderPayloadSchema = z.object({
  name: assetNodeNameSchema,
  parentId: assetParentIdSchema,
});

export const assetRenamePayloadSchema = z.object({
  name: assetNodeNameSchema,
});

export const assetMovePayloadSchema = z.object({
  parentId: assetParentIdSchema,
});

export const assetListQuerySchema = z.object({
  parentId: assetParentIdSchema,
});

export const assetNodeDocumentSchema = z.object({
  organizationId: z.string().trim().min(1),
  kind: z.enum(["folder", "file"]),
  parentId: z.string().trim().min(1).nullable(),
  name: assetNodeNameSchema,
  normalizedName: z.string().trim().min(1),
  mimeType: z.string().trim().min(1).nullable().optional(),
  extension: z.string().trim().min(1).nullable().optional(),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  blobKey: z.string().trim().min(1).nullable().optional(),
  downloadToken: z.string().trim().min(1).nullable().optional(),
  provider: z.enum(["firebase-storage"]),
  status: z.enum(["ready", "uploading", "failed"]),
  createdBy: z.string().trim().min(1),
  updatedBy: z.string().trim().min(1),
  createdAt: firestoreTimestampSchema,
  updatedAt: firestoreTimestampSchema,
});

export type AssetFolderPayload = z.infer<typeof assetFolderPayloadSchema>;
export type AssetMovePayload = z.infer<typeof assetMovePayloadSchema>;
export type AssetRenamePayload = z.infer<typeof assetRenamePayloadSchema>;
