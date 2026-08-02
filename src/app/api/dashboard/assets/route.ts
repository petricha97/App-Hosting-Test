import { NextResponse } from "next/server";

import { assetListQuerySchema } from "@/features/assets/schema";
import {
  buildAssetFolderPayload,
  requireScopedFolder,
} from "@/features/assets/server/asset-helpers";
import { resolveAssetsRouteScope } from "@/features/assets/server/route-scope";

export async function GET(request: Request) {
  const scope = await resolveAssetsRouteScope();
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const url = new URL(request.url);
  const parsed = assetListQuerySchema.safeParse({
    parentId: url.searchParams.get("parentId"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const folder = await requireScopedFolder({
    organizationId: scope.organizationId,
    nodeId: parsed.data.parentId,
  });

  if (parsed.data.parentId && !folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  return NextResponse.json(
    await buildAssetFolderPayload({
      organizationId: scope.organizationId,
      folderId: parsed.data.parentId,
    }),
  );
}
