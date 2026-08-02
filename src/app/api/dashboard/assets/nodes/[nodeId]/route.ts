import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import {
  assetRenamePayloadSchema,
  normalizeAssetNameForUniqueness,
} from "@/features/assets/schema";
import {
  assertUniqueAssetName,
  getScopedAssetNode,
} from "@/features/assets/server/asset-helpers";
import { resolveAssetsRouteScope } from "@/features/assets/server/route-scope";
import { getAssetBlobStore } from "@/lib/assets/blob-store";
import { getAssetCatalogStore } from "@/lib/assets/catalog-store";

interface RouteContext {
  params: Promise<{ nodeId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { nodeId } = await context.params;
  const scope = await resolveAssetsRouteScope({
    requireWriteOrganization: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const node = await getScopedAssetNode({
    organizationId: scope.organizationId,
    nodeId,
  });
  if (!node) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = assetRenamePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const nameAvailable = await assertUniqueAssetName({
    organizationId: scope.organizationId,
    parentId: node.parentId,
    name: parsed.data.name,
    excludeNodeId: nodeId,
  });
  if (!nameAvailable) {
    return NextResponse.json(
      { error: "That name already exists in this folder." },
      { status: 409 },
    );
  }

  await getAssetCatalogStore().updateNode(nodeId, {
    name: parsed.data.name,
    normalizedName: normalizeAssetNameForUniqueness(parsed.data.name),
    updatedBy: scope.userEmail,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { nodeId } = await context.params;
  const scope = await resolveAssetsRouteScope({
    requireWriteOrganization: true,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const catalog = getAssetCatalogStore();
  const node = await getScopedAssetNode({
    organizationId: scope.organizationId,
    nodeId,
  });
  if (!node) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (node.kind === "folder") {
    const hasChildren = await catalog.hasChildren({
      organizationId: scope.organizationId,
      nodeId,
    });

    if (hasChildren) {
      return NextResponse.json(
        { error: "Only empty folders can be deleted right now." },
        { status: 409 },
      );
    }
  }

  if (node.kind === "file" && node.blobKey) {
    await getAssetBlobStore().delete(node.blobKey);
  }

  await catalog.deleteNode(nodeId);
  return NextResponse.json({ success: true });
}
