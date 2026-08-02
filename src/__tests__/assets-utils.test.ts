import { describe, expect, it } from "vitest";

import {
  buildAssetBreadcrumbs,
  buildFolderOptionLabel,
  formatAssetSize,
  sortAssetNodes,
} from "@/features/assets/utils";
import type { AssetNodeDoc, WithId } from "@/types/collection";

function folder(id: string, name: string, parentId: string | null): WithId<AssetNodeDoc> {
  return {
    id,
    organizationId: "org-1",
    kind: "folder",
    parentId,
    name,
    normalizedName: name.toLowerCase(),
    mimeType: null,
    extension: null,
    sizeBytes: null,
    blobKey: null,
    downloadToken: null,
    provider: "firebase-storage",
    status: "ready",
    createdBy: "user@example.com",
    updatedBy: "user@example.com",
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedAt: { seconds: 1, nanoseconds: 0 },
  };
}

function file(id: string, name: string): WithId<AssetNodeDoc> {
  return {
    ...folder(id, name, null),
    kind: "file",
    mimeType: "application/pdf",
    extension: "pdf",
    sizeBytes: 1234,
    blobKey: "blob-key",
    downloadToken: "token",
  };
}

describe("assets utils", () => {
  it("sorts folders ahead of files", () => {
    const sorted = sortAssetNodes([
      file("file-a", "Contract.pdf"),
      folder("folder-b", "Brand", null),
      folder("folder-a", "Assets", null),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual([
      "folder-a",
      "folder-b",
      "file-a",
    ]);
  });

  it("builds breadcrumbs from ancestor folders", () => {
    expect(
      buildAssetBreadcrumbs([
        { id: "folder-a", name: "Brand" },
        { id: "folder-b", name: "Logos" },
      ]),
    ).toEqual([
      { id: null, name: "Assets" },
      { id: "folder-a", name: "Brand" },
      { id: "folder-b", name: "Logos" },
    ]);
  });

  it("builds folder option labels from parent chains", () => {
    const foldersById = new Map([
      ["folder-a", { id: "folder-a", name: "Brand", parentId: null }],
      ["folder-b", { id: "folder-b", name: "Logos", parentId: "folder-a" }],
    ]);

    expect(buildFolderOptionLabel("folder-b", "folder-a", foldersById)).toBe(
      "Assets / Brand / Logos",
    );
  });

  it("formats byte sizes for display", () => {
    expect(formatAssetSize(null)).toBe("-");
    expect(formatAssetSize(512)).toBe("512 B");
    expect(formatAssetSize(2048)).toBe("2.0 KB");
    expect(formatAssetSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
