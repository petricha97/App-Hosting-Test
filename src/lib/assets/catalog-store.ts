import type { AssetNodeDoc, WithId } from "@/types/collection";

export interface AssetCatalogStore {
  createNodeId(): string;
  listChildren(input: {
    organizationId: string;
    parentId: string | null;
  }): Promise<WithId<AssetNodeDoc>[]>;
  listFoldersForOrganization(organizationId: string): Promise<WithId<AssetNodeDoc>[]>;
  getNode(nodeId: string): Promise<WithId<AssetNodeDoc> | null>;
  createNode(node: AssetNodeDoc, nodeId?: string): Promise<string>;
  updateNode(nodeId: string, data: Partial<AssetNodeDoc>): Promise<void>;
  deleteNode(nodeId: string): Promise<void>;
  hasChildren(input: { organizationId: string; nodeId: string }): Promise<boolean>;
}

import { firestoreAssetCatalogStore } from "@/lib/assets/repositories/firestore-asset-catalog";

export function getAssetCatalogStore(): AssetCatalogStore {
  return firestoreAssetCatalogStore;
}
