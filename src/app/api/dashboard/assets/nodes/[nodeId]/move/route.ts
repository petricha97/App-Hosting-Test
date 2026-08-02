import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { assetMovePayloadSchema } from "@/features/assets/schema";
import {
  assertUniqueAssetName,
  getScopedAssetNode,
  requireScopedFolder,
  wouldCreateAssetCycle,
} from "@/features/assets/server/asset-helpers";
import { resolveAssetsRouteScope } from "@/features/assets/server/route-scope";
import { getAssetCatalogStore } from "@/lib/assets/catalog-store";

interface RouteContext {
  params: Promise<{ nodeId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
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
  const parsed = assetMovePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const destinationFolder = await requireScopedFolder({
    organizationId: scope.organizationId,
    nodeId: parsed.data.parentId,
  });
  if (parsed.data.parentId && !destinationFolder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  if (
    node.kind === "folder" &&
    (await wouldCreateAssetCycle({
      organizationId: scope.organizationId,
      sourceFolderId: node.id,
      destinationParentId: parsed.data.parentId,
    }))
  ) {
    return NextResponse.json(
      { error: "A folder cannot be moved into itself or its descendants." },
      { status: 409 },
    );
  }

  const nameAvailable = await assertUniqueAssetName({
    organizationId: scope.organizationId,
    parentId: parsed.data.parentId,
    name: node.name,
    excludeNodeId: node.id,
  });
  if (!nameAvailable) {
    return NextResponse.json(
      { error: "That name already exists in the destination folder." },
      { status: 409 },
    );
  }

  await getAssetCatalogStore().updateNode(nodeId, {
    parentId: destinationFolder?.id ?? null,
    updatedBy: scope.userEmail,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ success: true });
}
