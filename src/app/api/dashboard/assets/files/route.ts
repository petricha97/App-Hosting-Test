import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { getFileExtension, serializeAssetNode } from "@/features/assets/utils";
import {
  assertUniqueAssetName,
  requireScopedFolder,
  validateUploadFile,
} from "@/features/assets/server/asset-helpers";
import { normalizeAssetNameForUniqueness } from "@/features/assets/schema";
import { resolveAssetsRouteScope } from "@/features/assets/server/route-scope";
import { getAssetBlobStore } from "@/lib/assets/blob-store";
import { getAssetCatalogStore } from "@/lib/assets/catalog-store";

export async function POST(request: Request) {
  const scope = await resolveAssetsRouteScope({
    requireWriteOrganization: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const parentIdRaw = formData.get("parentId");
  const parentId =
    typeof parentIdRaw === "string" && parentIdRaw.trim().length > 0
      ? parentIdRaw.trim()
      : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file upload" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "Uploaded file is empty" }, { status: 400 });
  }

  const uploadError = validateUploadFile(file);
  if (uploadError) {
    return NextResponse.json({ error: uploadError }, { status: 400 });
  }

  const parentFolder = await requireScopedFolder({
    organizationId: scope.organizationId,
    nodeId: parentId,
  });
  if (parentId && !parentFolder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const nameAvailable = await assertUniqueAssetName({
    organizationId: scope.organizationId,
    parentId: parentId,
    name: file.name,
  });
  if (!nameAvailable) {
    return NextResponse.json(
      { error: "That file name already exists in this folder." },
      { status: 409 },
    );
  }

  const catalog = getAssetCatalogStore();
  const blobStore = getAssetBlobStore();
  const nodeId = catalog.createNodeId();
  const now = FieldValue.serverTimestamp();
  const normalizedName = normalizeAssetNameForUniqueness(file.name);
  const extension = getFileExtension(file.name);

  try {
    const upload = await blobStore.upload({
      organizationId: scope.organizationId,
      assetId: nodeId,
      originalName: file.name,
      contentType: file.type || "application/octet-stream",
      buffer: Buffer.from(await file.arrayBuffer()),
    });

    await catalog.createNode({
      organizationId: scope.organizationId,
      kind: "file",
      parentId: parentFolder?.id ?? null,
      name: file.name,
      normalizedName,
      mimeType: file.type || "application/octet-stream",
      extension,
      sizeBytes: file.size,
      blobKey: upload.blobKey,
      downloadToken: upload.downloadToken,
      provider: upload.provider,
      status: "ready",
      createdBy: scope.userEmail,
      updatedBy: scope.userEmail,
      createdAt: now,
      updatedAt: now,
    }, nodeId);

    return NextResponse.json({
      node: serializeAssetNode(
        {
          id: nodeId,
          organizationId: scope.organizationId,
          kind: "file",
          parentId: parentFolder?.id ?? null,
          name: file.name,
          normalizedName,
          mimeType: file.type || "application/octet-stream",
          extension,
          sizeBytes: file.size,
          blobKey: upload.blobKey,
          downloadToken: upload.downloadToken,
          provider: upload.provider,
          status: "ready",
          createdBy: scope.userEmail,
          updatedBy: scope.userEmail,
          createdAt: now,
          updatedAt: now,
        },
        blobStore.getDownloadUrl(upload.blobKey, upload.downloadToken),
      ),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to upload file",
      },
      { status: 500 },
    );
  }
}
