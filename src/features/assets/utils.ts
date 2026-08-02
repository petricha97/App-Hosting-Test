import type { AssetNodeDoc, WithId } from "@/types/collection";

export interface AssetBreadcrumbItem {
  id: string | null;
  name: string;
}

export interface AssetFolderOption {
  id: string;
  label: string;
}

export interface SerializedAssetNode {
  id: string;
  kind: AssetNodeDoc["kind"];
  parentId: string | null;
  name: string;
  mimeType: string | null;
  extension: string | null;
  sizeBytes: number | null;
  sizeLabel: string;
  updatedAtIso: string | null;
  updatedAtLabel: string;
  downloadUrl: string | null;
}

export interface AssetFolderPayload {
  currentFolder: SerializedAssetNode | null;
  breadcrumbs: AssetBreadcrumbItem[];
  nodes: SerializedAssetNode[];
}

function serializeTimestamp(
  value: AssetNodeDoc["updatedAt"] | AssetNodeDoc["createdAt"],
): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  if ("seconds" in value) {
    return new Date(Number(value.seconds) * 1000).toISOString();
  }

  return null;
}

export function formatAssetUpdatedAt(isoString: string | null) {
  if (!isoString) {
    return "Updated recently";
  }

  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

export function formatAssetSize(sizeBytes: number | null | undefined) {
  if (sizeBytes == null) {
    return "-";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileExtension(name: string) {
  const parts = name.split(".");
  if (parts.length < 2) {
    return null;
  }

  const extension = parts.pop()?.trim().toLowerCase() ?? "";
  return extension || null;
}

export function getAssetKindLabel(node: Pick<AssetNodeDoc, "kind" | "mimeType">) {
  if (node.kind === "folder") {
    return "Folder";
  }

  if (node.mimeType === "application/pdf") {
    return "PDF";
  }

  return "Image";
}

export function sortAssetNodes(nodes: WithId<AssetNodeDoc>[]) {
  return [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "folder" ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

export function serializeAssetNode(
  node: WithId<AssetNodeDoc>,
  downloadUrl: string | null = null,
): SerializedAssetNode {
  const updatedAtIso = serializeTimestamp(node.updatedAt);

  return {
    id: node.id,
    kind: node.kind,
    parentId: node.parentId,
    name: node.name,
    mimeType: node.mimeType ?? null,
    extension: node.extension ?? null,
    sizeBytes: node.sizeBytes ?? null,
    sizeLabel: formatAssetSize(node.sizeBytes ?? null),
    updatedAtIso,
    updatedAtLabel: formatAssetUpdatedAt(updatedAtIso),
    downloadUrl,
  };
}

export function buildAssetBreadcrumbs(
  ancestors: Array<Pick<WithId<AssetNodeDoc>, "id" | "name">>,
): AssetBreadcrumbItem[] {
  return [
    { id: null, name: "Assets" },
    ...ancestors.map((node) => ({ id: node.id, name: node.name })),
  ];
}

export function buildFolderOptionLabel(
  nodeId: string,
  parentId: string | null,
  foldersById: Map<string, Pick<WithId<AssetNodeDoc>, "id" | "name" | "parentId">>,
): string {
  const segments: string[] = [];
  let currentId: string | null = nodeId;

  while (currentId) {
    const current = foldersById.get(currentId);
    if (!current) break;
    segments.unshift(current.name);
    currentId = current.parentId;
  }

  if (!segments.length && parentId === null) {
    return "Assets";
  }

  return `Assets / ${segments.join(" / ")}`;
}
