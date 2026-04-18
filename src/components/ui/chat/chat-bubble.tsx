/**
 * Chat Bubble components
 *
 * A set of composable components that render individual chat messages.
 * Each message is a "bubble" that changes appearance based on who sent it:
 *   - variant="sent"     → right-aligned, primary background (user messages)
 *   - variant="received" → left-aligned, secondary background (AI messages)
 *
 * Components exported:
 *   ChatBubble            - Outer wrapper; positions the bubble left or right
 *   ChatBubbleAvatar      - Optional avatar image shown beside the bubble
 *   ChatBubbleMessage     - The actual message text area inside the bubble
 *   ChatBubbleTimestamp   - Optional small timestamp shown under the message
 *   ChatBubbleActionWrapper - Hover-reveal action buttons (e.g. copy, delete)
 *
 * Usage:
 *   <ChatBubble variant="sent">
 *     <ChatBubbleMessage variant="sent">Hello!</ChatBubbleMessage>
 *   </ChatBubble>
 *
 *   <ChatBubble variant="received">
 *     <ChatBubbleMessage variant="received" isLoading />  ← shows loading dots
 *   </ChatBubble>
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import MessageLoading from "./message-loading";
import { Button } from "../button";

// ─── ChatBubble ───────────────────────────────────────────────────────────────

/** Controls outer positioning: sent = right side, received = left side */
const chatBubbleVariant = cva(
  "flex gap-2 max-w-[60%] items-end relative group",
  {
    variants: {
      variant: {
        received: "self-start",
        sent: "self-end flex-row-reverse",
      },
      layout: {
        default: "",
        /** ai layout: full width, used for long AI responses */
        ai: "max-w-full w-full items-center",
      },
    },
    defaultVariants: {
      variant: "received",
      layout: "default",
    },
  },
);

interface ChatBubbleProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof chatBubbleVariant> {}

/** Outer bubble wrapper — automatically passes variant/layout down to children */
const ChatBubble = React.forwardRef<HTMLDivElement, ChatBubbleProps>(
  ({ className, variant, layout, children, ...props }, ref) => (
    <div
      className={cn(
        chatBubbleVariant({ variant, layout, className }),
        "relative group",
      )}
      ref={ref}
      {...props}
    >
      {/* Propagate variant and layout to child components automatically */}
      {React.Children.map(children, (child) =>
        React.isValidElement(child) && typeof child.type !== "string"
          ? React.cloneElement(child, {
              variant,
              layout,
            } as React.ComponentProps<typeof child.type>)
          : child,
      )}
    </div>
  ),
);
ChatBubble.displayName = "ChatBubble";

// ─── ChatBubbleAvatar ─────────────────────────────────────────────────────────

interface ChatBubbleAvatarProps {
  src?: string;
  fallback?: string;
  className?: string;
}

/** Small avatar shown next to the bubble (optional).
 *  Falls back to initials text if the image URL is missing or fails to load. */
const ChatBubbleAvatar: React.FC<ChatBubbleAvatarProps> = ({
  src,
  fallback,
  className,
}) => (
  <Avatar className={className}>
    <AvatarImage src={src} alt="Avatar" />
    <AvatarFallback>{fallback}</AvatarFallback>
  </Avatar>
);

// ─── ChatBubbleMessage ────────────────────────────────────────────────────────

/** Controls the inner message background and text colours */
const chatBubbleMessageVariants = cva("p-4", {
  variants: {
    variant: {
      received:
        "bg-secondary text-secondary-foreground rounded-r-lg rounded-tl-lg",
      sent: "bg-primary text-primary-foreground rounded-l-lg rounded-tr-lg",
    },
    layout: {
      default: "",
      ai: "border-t w-full rounded-none bg-transparent",
    },
  },
  defaultVariants: {
    variant: "received",
    layout: "default",
  },
});

interface ChatBubbleMessageProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof chatBubbleMessageVariants> {
  /** When true, shows the animated loading dots instead of the message text */
  isLoading?: boolean;
}

/** The message content area. Pass isLoading=true to show the typing indicator. */
const ChatBubbleMessage = React.forwardRef<
  HTMLDivElement,
  ChatBubbleMessageProps
>(
  (
    { className, variant, layout, isLoading = false, children, ...props },
    ref,
  ) => (
    <div
      className={cn(
        chatBubbleMessageVariants({ variant, layout, className }),
        "break-words max-w-full whitespace-pre-wrap",
      )}
      ref={ref}
      {...props}
    >
      {isLoading ? (
        <div className="flex items-center space-x-2">
          <MessageLoading />
        </div>
      ) : (
        children
      )}
    </div>
  ),
);
ChatBubbleMessage.displayName = "ChatBubbleMessage";

// ─── ChatBubbleTimestamp ──────────────────────────────────────────────────────

interface ChatBubbleTimestampProps extends React.HTMLAttributes<HTMLDivElement> {
  timestamp: string;
}

/** Small timestamp text shown below a message bubble */
const ChatBubbleTimestamp: React.FC<ChatBubbleTimestampProps> = ({
  timestamp,
  className,
  ...props
}) => (
  <div className={cn("text-xs mt-2 text-right", className)} {...props}>
    {timestamp}
  </div>
);

// ─── ChatBubbleActionWrapper ──────────────────────────────────────────────────

interface ChatBubbleActionWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "sent" | "received";
  className?: string;
}

/** Container for action buttons (e.g. copy, delete) that appear on hover.
 *  Positions itself to the left of sent bubbles and right of received bubbles. */
const ChatBubbleActionWrapper = React.forwardRef<
  HTMLDivElement,
  ChatBubbleActionWrapperProps
>(({ variant, className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "absolute top-1/2 -translate-y-1/2 flex opacity-0 group-hover:opacity-100 transition-opacity duration-200",
      variant === "sent"
        ? "-left-1 -translate-x-full flex-row-reverse"
        : "-right-1 translate-x-full",
      className,
    )}
    {...props}
  >
    {children}
  </div>
));
ChatBubbleActionWrapper.displayName = "ChatBubbleActionWrapper";

export {
  ChatBubble,
  ChatBubbleAvatar,
  ChatBubbleMessage,
  ChatBubbleTimestamp,
  chatBubbleVariant,
  chatBubbleMessageVariants,
  ChatBubbleActionWrapper,
};
