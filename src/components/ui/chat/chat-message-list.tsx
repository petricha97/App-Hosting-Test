/**
 * ChatMessageList
 *
 * A scrollable container that holds all chat bubbles.
 * Uses the useAutoScroll hook to:
 *   - Automatically scroll to the latest message when new ones arrive
 *   - Show a "↓" button when the user has scrolled up and new messages appear
 *
 * Props:
 *   smooth - If true, uses smooth scrolling when jumping to the bottom (default false)
 *   children - The ChatBubble elements to render
 *
 * Usage:
 *   <ChatMessageList>
 *     {messages.map((msg) => <ChatBubble key={msg.id}>...</ChatBubble>)}
 *   </ChatMessageList>
 */

import * as React from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAutoScroll } from "@/components/ui/chat/hooks/useAutoScroll";

interface ChatMessageListProps extends React.HTMLAttributes<HTMLDivElement> {
  smooth?: boolean;
}

const ChatMessageList = React.forwardRef<HTMLDivElement, ChatMessageListProps>(
  ({ className, children, smooth = false, ...props }, _ref) => {
    const { scrollRef, isAtBottom, scrollToBottom, disableAutoScroll } =
      useAutoScroll({ smooth, content: children });

    return (
      <div className="relative w-full h-full">
        {/* Scrollable message area — wheel/touch events pause auto-scroll */}
        <div
          className={`flex flex-col w-full h-full p-4 overflow-y-auto ${className}`}
          ref={scrollRef}
          onWheel={disableAutoScroll}
          onTouchMove={disableAutoScroll}
          {...props}
        >
          <div className="flex flex-col gap-6">{children}</div>
        </div>

        {/* "Scroll to bottom" button — only shown when the user has scrolled up */}
        {!isAtBottom && (
          <Button
            onClick={scrollToBottom}
            size="icon"
            variant="outline"
            className="absolute bottom-2 left-1/2 transform -translate-x-1/2 inline-flex rounded-full shadow-md"
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  },
);

ChatMessageList.displayName = "ChatMessageList";

export { ChatMessageList };
