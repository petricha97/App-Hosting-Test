"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

interface UserAvatarUploadProps {
  userName: string;
  currentAvatarUrl?: string | null;
  onUploaded?: (url: string) => void;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserAvatarUpload({
  userName,
  currentAvatarUrl,
  onUploaded,
}: UserAvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(
    currentAvatarUrl ?? null,
  );
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2 MB.");
      return;
    }

    // Snapshot the last confirmed URL so we can revert to it on failure,
    // not to the original prop (which may now be stale after a prior upload).
    const prevUrl = preview;
    const blobUrl = URL.createObjectURL(file);
    setPreview(blobUrl);

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/dashboard/settings/profile/avatar", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? "Upload failed");
      }

      const { avatarUrl } = await res.json();
      setPreview(avatarUrl);
      onUploaded?.(avatarUrl);
      toast.success("Profile picture updated.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Upload failed. Please try again.",
      );
      setPreview(prevUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar className="h-16 w-16">
        <AvatarImage
          src={preview ?? undefined}
          alt={userName}
          className="object-cover"
        />
        <AvatarFallback className="bg-slate-100 text-lg font-semibold text-slate-600">
          {getInitials(userName)}
        </AvatarFallback>
      </Avatar>

      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-900">Profile picture</p>
        <p className="text-xs text-slate-500">
          JPEG, PNG, WebP or GIF · Max 2 MB
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-2 h-3.5 w-3.5" />
          {uploading ? "Uploading…" : "Upload photo"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
}
