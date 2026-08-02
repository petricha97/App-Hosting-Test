import "server-only";

import {
  ASSET_ALLOWED_FILE_TYPES,
  ASSET_MAX_IMAGE_BYTES,
  ASSET_MAX_PDF_BYTES,
  normalizeAssetNameForUniqueness,
} from "@/features/assets/schema";
import { buildAssetBreadcrumbs, buildFolderOptionLabel, serializeAssetNode } from "@/features/assets/utils";
import { getAssetBlobStore } from "@/lib/assets/blob-store";
import { getAssetCatalogStore } from "@/lib/assets/catalog-store";
import type { AssetNodeDoc, WithId } from "@/types/collection";

export async function getScopedAssetNode(input: {
  organizationId: string;
  nodeId: string;
}) {
  const catalog = getAssetCatalogStore();
  const node = await catalog.getNode(input.nodeId);

  if (!node || node.organizationId !== input.organizationId) {
    return null;
  }

  return node;
}

export async function requireScopedFolder(input: {
  organizationId: string;
  nodeId: string | null;
}) {
  if (!input.nodeId) {
    return null;
  }

  const node = await getScopedAssetNode({
    organizationId: input.organizationId,
    nodeId: input.nodeId,
  });

  if (!node || node.kind !== "folder") {
    return null;
  }

  return node;
}

export async function assertUniqueAssetName(input: {
  organizationId: string;
  parentId: string | null;
  name: string;
  excludeNodeId?: string;
}) {
  const catalog = getAssetCatalogStore();
  const siblings = await catalog.listChildren({
    organizationId: input.organizationId,
    parentId: input.parentId,
  });
  const normalizedName = normalizeAssetNameForUniqueness(input.name);

  return !siblings.some((sibling) => {
    if (input.excludeNodeId && sibling.id === input.excludeNodeId) {
      return false;
    }

    return sibling.normalizedName === normalizedName;
  });
}

export async function buildAssetFolderAncestors(input: {
  organizationId: string;
  folderId: string | null;
}) {
  const ancestors: Array<WithId<AssetNodeDoc>> = [];
  let currentId = input.folderId;

  while (currentId) {
    const current = await getScopedAssetNode({
      organizationId: input.organizationId,
      nodeId: currentId,
    });

    if (!current || current.kind !== "folder") {
      break;
    }

    ancestors.unshift(current);
    currentId = current.parentId;
  }

  return ancestors;
}

export async function buildAssetFolderPayload(input: {
  organizationId: string;
  folderId: string | null;
}) {
  const catalog = getAssetCatalogStore();
  const blobStore = getAssetBlobStore();
  const currentFolder = input.folderId
    ? await requireScopedFolder({
        organizationId: input.organizationId,
        nodeId: input.folderId,
      })
    : null;

  const children = await catalog.listChildren({
    organizationId: input.organizationId,
    parentId: currentFolder?.id ?? null,
  });
  const ancestors = await buildAssetFolderAncestors({
    organizationId: input.organizationId,
    folderId: currentFolder?.id ?? null,
  });

  return {
    currentFolder: currentFolder
      ? serializeAssetNode(currentFolder)
      : null,
    breadcrumbs: buildAssetBreadcrumbs(
      ancestors.map((folder) => ({ id: folder.id, name: folder.name })),
    ),
    nodes: children.map((node) =>
      serializeAssetNode(
        node,
        node.kind === "file" && node.blobKey && node.downloadToken
          ? blobStore.getDownloadUrl(node.blobKey, node.downloadToken)
          : null,
      ),
    ),
  };
}

export async function buildAssetFolderOptions(organizationId: string) {
  const catalog = getAssetCatalogStore();
  const folders = await catalog.listFoldersForOrganization(organizationId);
  const foldersById = new Map(
    folders.map((folder) => [
      folder.id,
      { id: folder.id, name: folder.name, parentId: folder.parentId },
    ]),
  );

  return [
    { id: "__root__", label: "Assets" },
    ...folders.map((folder) => ({
      id: folder.id,
      label: buildFolderOptionLabel(folder.id, folder.parentId, foldersById),
    })),
  ];
}

export async function wouldCreateAssetCycle(input: {
  organizationId: string;
  sourceFolderId: string;
  destinationParentId: string | null;
}) {
  if (!input.destinationParentId) {
    return false;
  }

  if (input.destinationParentId === input.sourceFolderId) {
    return true;
  }

  let currentId: string | null = input.destinationParentId;
  while (currentId) {
    if (currentId === input.sourceFolderId) {
      return true;
    }

    const current = await requireScopedFolder({
      organizationId: input.organizationId,
      nodeId: currentId,
    });
    if (!current) {
      return false;
    }

    currentId = current.parentId;
  }

  return false;
}

export function validateUploadFile(file: File) {
  if (!ASSET_ALLOWED_FILE_TYPES.has(file.type)) {
    return "Only images and PDFs are supported right now.";
  }

  if (file.type === "application/pdf" && file.size > ASSET_MAX_PDF_BYTES) {
    return "PDF files must be 25 MB or smaller.";
  }

  if (file.type !== "application/pdf" && file.size > ASSET_MAX_IMAGE_BYTES) {
    return "Images must be 10 MB or smaller.";
  }

  return null;
}
