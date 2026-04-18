/**
 * Avatar component
 *
 * A small circular image used to represent a user or bot in the chat UI.
 * Built on top of Radix UI's Avatar primitive which handles:
 *   - Loading the image and showing it once ready
 *   - Falling back to initials/text if the image fails to load
 *
 * Usage:
 *   <Avatar>
 *     <AvatarImage src="/user.png" alt="User" />
 *     <AvatarFallback>JD</AvatarFallback>  ← shown if image fails
 *   </Avatar>
 */

import * as React from "react";
import { Avatar } from "radix-ui";
import { cn } from "@/lib/utils";

/** Root container — renders as a round clipped circle */
function AvatarRoot({
  className,
  ...props
}: React.ComponentProps<typeof Avatar.Root>) {
  return (
    <Avatar.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        className,
      )}
      {...props}
    />
  );
}

/** The actual <img> — only visible once the image has successfully loaded */
function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof Avatar.Image>) {
  return (
    <Avatar.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full", className)}
      {...props}
    />
  );
}

/** Fallback content shown while the image is loading or if it errors */
function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof Avatar.Fallback>) {
  return (
    <Avatar.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "bg-muted flex size-full items-center justify-center rounded-full text-xs font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { AvatarRoot as Avatar, AvatarImage, AvatarFallback };
