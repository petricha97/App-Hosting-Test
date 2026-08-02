"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  FileImage,
  FileText,
  Folder,
  Info,
  LayoutGrid,
  Loader2,
  List,
  MoveRight,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AssetMoveDialog } from "@/features/assets/components/asset-move-dialog";
import { AssetNameDialog } from "@/features/assets/components/asset-name-dialog";
import type {
  AssetFolderOption,
  AssetFolderPayload,
  SerializedAssetNode,
} from "@/features/assets/utils";
import { getAssetKindLabel } from "@/features/assets/utils";

interface AssetsLibraryPageProps {
  canManage: boolean;
  initialFolderPayload: AssetFolderPayload;
  initialFolderOptions: AssetFolderOption[];
}

async function parseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as
    | { error?: string | { fieldErrors?: Record<string, string[]> } }
    | null;

  if (typeof body?.error === "string") {
    return body.error;
  }

  return fallback;
}

export function AssetsLibraryPage({
  canManage,
  initialFolderPayload,
  initialFolderOptions,
}: AssetsLibraryPageProps) {
  const [folderPayload, setFolderPayload] = useState(initialFolderPayload);
  const [folderOptions, setFolderOptions] = useState(initialFolderOptions);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [loadingFolder, setLoadingFolder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submittingName, setSubmittingName] = useState(false);
  const [submittingMove, setSubmittingMove] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [renameNode, setRenameNode] = useState<SerializedAssetNode | null>(null);
  const [moveNode, setMoveNode] = useState<SerializedAssetNode | null>(null);
  const [propertiesNode, setPropertiesNode] = useState<SerializedAssetNode | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    node: SerializedAssetNode;
    x: number;
    y: number;
  } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const currentFolderId = folderPayload.currentFolder?.id ?? null;

  async function refreshFolderOptions() {
    const response = await fetch("/api/dashboard/assets/folders", {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(await parseError(response, "Unable to refresh folders."));
    }

    const payload = (await response.json()) as { folders: AssetFolderOption[] };
    setFolderOptions(payload.folders);
  }

  async function loadFolder(parentId: string | null) {
    setLoadingFolder(true);

    try {
      const url = new URL("/api/dashboard/assets", window.location.origin);
      if (parentId) {
        url.searchParams.set("parentId", parentId);
      }

      const response = await fetch(url.toString(), { method: "GET" });
      if (!response.ok) {
        throw new Error(await parseError(response, "Unable to open folder."));
      }

      const payload = (await response.json()) as AssetFolderPayload;
      setFolderPayload(payload);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to open folder.",
      );
    } finally {
      setLoadingFolder(false);
    }
  }

  async function handleCreateFolder(name: string) {
    setSubmittingName(true);

    try {
      const response = await fetch("/api/dashboard/assets/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          parentId: currentFolderId,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseError(response, "Unable to create folder."));
      }

      const payload = (await response.json()) as { node: SerializedAssetNode };
      setFolderPayload((current) => ({
        ...current,
        nodes: [...current.nodes, payload.node].sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === "folder" ? -1 : 1;
          }

          return left.name.localeCompare(right.name, undefined, {
            sensitivity: "base",
            numeric: true,
          });
        }),
      }));
      await refreshFolderOptions();
      toast.success("Folder created");
    } finally {
      setSubmittingName(false);
    }
  }

  async function handleRename(name: string) {
    if (!renameNode) return;

    setSubmittingName(true);

    try {
      const response = await fetch(
        `/api/dashboard/assets/nodes/${encodeURIComponent(renameNode.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );

      if (!response.ok) {
        throw new Error(await parseError(response, "Unable to rename item."));
      }

      await loadFolder(currentFolderId);
      await refreshFolderOptions();
      setRenameNode(null);
      toast.success("Item renamed");
    } finally {
      setSubmittingName(false);
    }
  }

  async function handleMove(parentId: string | null) {
    if (!moveNode) return;

    setSubmittingMove(true);

    try {
      const response = await fetch(
        `/api/dashboard/assets/nodes/${encodeURIComponent(moveNode.id)}/move`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId }),
        },
      );

      if (!response.ok) {
        throw new Error(await parseError(response, "Unable to move item."));
      }

      await loadFolder(currentFolderId);
      await refreshFolderOptions();
      setMoveNode(null);
      toast.success("Item moved");
    } finally {
      setSubmittingMove(false);
    }
  }

  async function handleDelete(node: SerializedAssetNode) {
    setDeletingId(node.id);

    try {
      const response = await fetch(
        `/api/dashboard/assets/nodes/${encodeURIComponent(node.id)}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        toast.error(await parseError(response, "Unable to delete item."));
        return;
      }

      await loadFolder(currentFolderId);
      await refreshFolderOptions();
      toast.success(node.kind === "folder" ? "Folder deleted" : "File deleted");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleUploadChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.set("file", file);
      if (currentFolderId) {
        formData.set("parentId", currentFolderId);
      }

      const response = await fetch("/api/dashboard/assets/files", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        toast.error(await parseError(response, "Unable to upload file."));
        return;
      }

      const payload = (await response.json()) as { node: SerializedAssetNode };
      setFolderPayload((current) => ({
        ...current,
        nodes: [...current.nodes, payload.node].sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === "folder" ? -1 : 1;
          }

          return left.name.localeCompare(right.name, undefined, {
            sensitivity: "base",
            numeric: true,
          });
        }),
      }));
      toast.success("File uploaded");
    } finally {
      event.target.value = "";
      setUploading(false);
    }
  }

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function closeMenu() {
      setContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  function openContextMenu(
    event: React.MouseEvent<HTMLDivElement>,
    node: SerializedAssetNode,
  ) {
    event.preventDefault();

    const menuWidth = 192;
    const menuHeight = 168;
    const padding = 16;
    const x = Math.min(
      event.clientX,
      window.innerWidth - menuWidth - padding,
    );
    const y = Math.min(
      event.clientY,
      window.innerHeight - menuHeight - padding,
    );

    setContextMenu({ node, x, y });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          {folderPayload.breadcrumbs.map((crumb, index) => (
            <div key={`${crumb.name}-${index}`} className="flex items-center gap-2">
              {index > 0 ? <span>/</span> : null}
              <button
                type="button"
                className="rounded-full px-1 py-0.5 transition hover:text-slate-950"
                onClick={() => void loadFolder(crumb.id)}
                disabled={loadingFolder}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
            <Button
              type="button"
              variant={viewMode === "cards" ? "default" : "ghost"}
              size="sm"
              className="rounded-full"
              onClick={() => setViewMode("cards")}
            >
              <LayoutGrid className="h-4 w-4" />
              Cards
            </Button>
            <Button
              type="button"
              variant={viewMode === "table" ? "default" : "ghost"}
              size="sm"
              className="rounded-full"
              onClick={() => setViewMode("table")}
            >
              <List className="h-4 w-4" />
              Table
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => void loadFolder(currentFolderId)}
            disabled={loadingFolder}
          >
            {loadingFolder ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
          {canManage ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Upload
              </Button>
              <Button
                type="button"
                className="rounded-full"
                onClick={() => setCreateFolderOpen(true)}
              >
                <Plus className="h-4 w-4" />
                New folder
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf"
        className="hidden"
        onChange={(event) => void handleUploadChange(event)}
      />

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="flex flex-row items-center justify-between gap-3 px-6 pt-6">
          <div className="space-y-2">
            <CardTitle className="text-2xl text-slate-950">
              {folderPayload.currentFolder?.name ?? "Assets"}
            </CardTitle>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-full text-slate-400 transition hover:text-slate-700"
              >
                <Info className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              One folder level loads at a time so the library stays fast and predictable.
            </TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-0">
          {folderPayload.nodes.length ? (
            viewMode === "table" ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="w-40 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {folderPayload.nodes.map((node) => (
                    <TableRow key={node.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                            {node.kind === "folder" ? (
                              <Folder className="h-4 w-4" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                          </span>
                          <div className="min-w-0">
                            {node.kind === "folder" ? (
                              <button
                                type="button"
                                className="truncate text-left text-sm font-semibold text-slate-950 transition hover:text-orange-900"
                                onClick={() => void loadFolder(node.id)}
                              >
                                {node.name}
                              </button>
                            ) : node.downloadUrl ? (
                              <Link
                                href={node.downloadUrl}
                                target="_blank"
                                className="truncate text-sm font-semibold text-slate-950 transition hover:text-orange-900"
                              >
                                {node.name}
                              </Link>
                            ) : (
                              <div className="truncate text-sm font-semibold text-slate-950">
                                {node.name}
                              </div>
                            )}
                            {node.mimeType ? (
                              <p className="truncate text-xs text-slate-500">{node.mimeType}</p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{getAssetKindLabel(node)}</TableCell>
                      <TableCell>{node.sizeLabel}</TableCell>
                      <TableCell>{node.updatedAtLabel}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {node.kind === "folder" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => void loadFolder(node.id)}
                              title="Open folder"
                            >
                              <ArrowUpRight className="h-4 w-4" />
                            </Button>
                          ) : node.downloadUrl ? (
                            <Button variant="ghost" size="icon" asChild title="Open file">
                              <Link href={node.downloadUrl} target="_blank">
                                <ArrowUpRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          ) : null}
                          {canManage ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => setMoveNode(node)}
                                title="Move item"
                              >
                                <MoveRight className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => setRenameNode(node)}
                                title="Rename item"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => void handleDelete(node)}
                                disabled={deletingId === node.id}
                                title="Delete item"
                              >
                                {deletingId === node.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {folderPayload.nodes.map((node) => (
                  <div
                    key={node.id}
                    className="group flex min-h-44 flex-col items-center justify-center rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-5 text-center shadow-sm transition hover:border-orange-200 hover:bg-orange-50/40"
                    onContextMenu={(event) => openContextMenu(event, node)}
                  >
                    {node.kind === "folder" ? (
                      <button
                        type="button"
                        className="flex w-full flex-col items-center gap-4"
                        onDoubleClick={() => void loadFolder(node.id)}
                        onClick={() => void loadFolder(node.id)}
                      >
                        <span className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-white text-slate-600 shadow-sm transition group-hover:text-orange-900">
                          <Folder className="h-9 w-9" />
                        </span>
                        <span className="line-clamp-2 max-w-full break-words text-sm font-semibold text-slate-950">
                          {node.name}
                        </span>
                      </button>
                    ) : node.downloadUrl ? (
                      <Link
                        href={node.downloadUrl}
                        target="_blank"
                        className="flex w-full flex-col items-center gap-4"
                      >
                        <span className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-white text-slate-600 shadow-sm transition group-hover:text-orange-900">
                          <FileText className="h-9 w-9" />
                        </span>
                        <span className="line-clamp-2 max-w-full break-words text-sm font-semibold text-slate-950">
                          {node.name}
                        </span>
                      </Link>
                    ) : (
                      <div className="flex w-full flex-col items-center gap-4">
                        <span className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-white text-slate-600 shadow-sm">
                          <FileText className="h-9 w-9" />
                        </span>
                        <span className="line-clamp-2 max-w-full break-words text-sm font-semibold text-slate-950">
                          {node.name}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-6 text-sm leading-7 text-slate-600">
              This folder is empty.
            </div>
          )}
        </CardContent>
      </Card>

      <AssetNameDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        title="New folder"
        description="Create a folder inside the current location."
        submitLabel="Create folder"
        submitting={submittingName}
        onSubmit={handleCreateFolder}
      />

      <AssetNameDialog
        open={Boolean(renameNode)}
        onOpenChange={(open) => {
          if (!open) {
            setRenameNode(null);
          }
        }}
        title="Rename item"
        description="Choose a new name for this file or folder."
        submitLabel="Save"
        initialName={renameNode?.name ?? ""}
        submitting={submittingName}
        onSubmit={handleRename}
      />

      <AssetMoveDialog
        open={Boolean(moveNode)}
        onOpenChange={(open) => {
          if (!open) {
            setMoveNode(null);
          }
        }}
        node={moveNode}
        options={folderOptions}
        submitting={submittingMove}
        onSubmit={handleMove}
      />

      <Dialog
        open={Boolean(propertiesNode)}
        onOpenChange={(open) => {
          if (!open) {
            setPropertiesNode(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Properties</DialogTitle>
            <DialogDescription>
              File and folder details for {propertiesNode?.name ?? "this item"}.
            </DialogDescription>
          </DialogHeader>

          {propertiesNode ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-600 shadow-sm">
                  {propertiesNode.kind === "folder" ? (
                    <Folder className="h-5 w-5" />
                  ) : propertiesNode.mimeType?.startsWith("image/") ? (
                    <FileImage className="h-5 w-5" />
                  ) : (
                    <FileText className="h-5 w-5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-slate-950">
                    {propertiesNode.name}
                  </p>
                  <p className="text-sm text-slate-500">
                    {getAssetKindLabel(propertiesNode)}
                  </p>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-slate-200 bg-white">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-sm">
                  <span className="text-slate-500">Name</span>
                  <span className="max-w-[60%] truncate font-medium text-slate-950">
                    {propertiesNode.name}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-sm">
                  <span className="text-slate-500">Type</span>
                  <span className="font-medium text-slate-950">
                    {getAssetKindLabel(propertiesNode)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-sm">
                  <span className="text-slate-500">Size</span>
                  <span className="font-medium text-slate-950">
                    {propertiesNode.sizeLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-sm">
                  <span className="text-slate-500">Updated</span>
                  <span className="text-right font-medium text-slate-950">
                    {propertiesNode.updatedAtLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="text-slate-500">MIME type</span>
                  <span className="max-w-[60%] truncate text-right font-medium text-slate-950">
                    {propertiesNode.mimeType ?? "-"}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPropertiesNode(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {viewMode === "cards" && contextMenu ? (
        <div
          className="fixed z-50 min-w-48 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
            onClick={() => {
              setRenameNode(contextMenu.node);
              setContextMenu(null);
            }}
          >
            <Pencil className="h-4 w-4" />
            Edit name
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
            onClick={() => {
              setPropertiesNode(contextMenu.node);
              setContextMenu(null);
            }}
          >
            <Info className="h-4 w-4" />
            Properties
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50"
            onClick={() => {
              void handleDelete(contextMenu.node);
              setContextMenu(null);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
