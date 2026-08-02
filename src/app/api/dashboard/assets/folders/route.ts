import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import {
  assetFolderPayloadSchema,
  normalizeAssetNameForUniqueness,
} from "@/features/assets/schema";
import {
  assertUniqueAssetName,
  buildAssetFolderOptions,
  requireScopedFolder,
} from "@/features/assets/server/asset-helpers";
import { resolveAssetsRouteScope } from "@/features/assets/server/route-scope";
import { serializeAssetNode } from "@/features/assets/utils";
import { getAssetCatalogStore } from "@/lib/assets/catalog-store";

export async function GET() {
  const scope = await resolveAssetsRouteScope();
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  return NextResponse.json({
    folders: await buildAssetFolderOptions(scope.organizationId),
  });
}

export async function POST(request: Request) {
  const scope = await resolveAssetsRouteScope({
    requireWriteOrganization: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = assetFolderPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const parentFolder = await requireScopedFolder({
    organizationId: scope.organizationId,
    nodeId: parsed.data.parentId,
  });
  if (parsed.data.parentId && !parentFolder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const nameAvailable = await assertUniqueAssetName({
    organizationId: scope.organizationId,
    parentId: parsed.data.parentId,
    name: parsed.data.name,
  });
  if (!nameAvailable) {
    return NextResponse.json(
      { error: "That name already exists in this folder." },
      { status: 409 },
    );
  }

  const catalog = getAssetCatalogStore();
  const nodeId = catalog.createNodeId();
  const now = FieldValue.serverTimestamp();

  await catalog.createNode({
    organizationId: scope.organizationId,
    kind: "folder",
    parentId: parentFolder?.id ?? null,
    name: parsed.data.name,
    normalizedName: normalizeAssetNameForUniqueness(parsed.data.name),
    mimeType: null,
    extension: null,
    sizeBytes: null,
    blobKey: null,
    downloadToken: null,
    provider: "firebase-storage",
    status: "ready",
    createdBy: scope.userEmail,
    updatedBy: scope.userEmail,
    createdAt: now,
    updatedAt: now,
  }, nodeId);

  return NextResponse.json({
    node: serializeAssetNode({
      id: nodeId,
      organizationId: scope.organizationId,
      kind: "folder",
      parentId: parentFolder?.id ?? null,
      name: parsed.data.name,
      normalizedName: normalizeAssetNameForUniqueness(parsed.data.name),
      mimeType: null,
      extension: null,
      sizeBytes: null,
      blobKey: null,
      downloadToken: null,
      provider: "firebase-storage",
      status: "ready",
      createdBy: scope.userEmail,
      updatedBy: scope.userEmail,
      createdAt: now,
      updatedAt: now,
    }),
  });
}
