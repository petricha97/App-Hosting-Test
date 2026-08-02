import "server-only";

import { adminDb } from "@/app/lib/firestore";
import type { AssetCatalogStore } from "@/lib/assets/catalog-store";
import { sortAssetNodes } from "@/features/assets/utils";
import type { AssetNodeDoc, WithId } from "@/types/collection";

const ASSET_NODE_COLLECTION = "AssetNode";

export class FirestoreAssetCatalogStore implements AssetCatalogStore {
  createNodeId() {
    return adminDb.collection(ASSET_NODE_COLLECTION).doc().id;
  }

  async listChildren(input: {
    organizationId: string;
    parentId: string | null;
  }): Promise<WithId<AssetNodeDoc>[]> {
    const snapshot = await adminDb
      .collection(ASSET_NODE_COLLECTION)
      .where("organizationId", "==", input.organizationId)
      .where("parentId", "==", input.parentId)
      .get();

    return sortAssetNodes(
      snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as AssetNodeDoc) })),
    );
  }

  async listFoldersForOrganization(
    organizationId: string,
  ): Promise<WithId<AssetNodeDoc>[]> {
    const snapshot = await adminDb
      .collection(ASSET_NODE_COLLECTION)
      .where("organizationId", "==", organizationId)
      .where("kind", "==", "folder")
      .get();

    return snapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as AssetNodeDoc) }))
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          sensitivity: "base",
          numeric: true,
        }),
      );
  }

  async getNode(nodeId: string): Promise<WithId<AssetNodeDoc> | null> {
    const snapshot = await adminDb.collection(ASSET_NODE_COLLECTION).doc(nodeId).get();
    if (!snapshot.exists) {
      return null;
    }

    return { id: snapshot.id, ...(snapshot.data() as AssetNodeDoc) };
  }

  async createNode(node: AssetNodeDoc, nodeId?: string) {
    if (nodeId) {
      await adminDb.collection(ASSET_NODE_COLLECTION).doc(nodeId).set(node);
      return nodeId;
    }

    const ref = await adminDb.collection(ASSET_NODE_COLLECTION).add(node);
    return ref.id;
  }

  async updateNode(nodeId: string, data: Partial<AssetNodeDoc>) {
    await adminDb.collection(ASSET_NODE_COLLECTION).doc(nodeId).update(data);
  }

  async deleteNode(nodeId: string) {
    await adminDb.collection(ASSET_NODE_COLLECTION).doc(nodeId).delete();
  }

  async hasChildren(input: { organizationId: string; nodeId: string }) {
    const snapshot = await adminDb
      .collection(ASSET_NODE_COLLECTION)
      .where("organizationId", "==", input.organizationId)
      .where("parentId", "==", input.nodeId)
      .limit(1)
      .get();

    return !snapshot.empty;
  }
}

export const firestoreAssetCatalogStore = new FirestoreAssetCatalogStore();
