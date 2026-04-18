/**
 * ChatInput
 *
 * A styled textarea used as the message input at the bottom of the chat widget.
 * Wraps the project's existing Textarea component with chat-specific defaults:
 *   - Fixed height (h-16) with no resize handle
 *   - autocomplete turned off
 *   - Accepts all standard textarea props (value, onChange, onKeyDown, placeholder, disabled, etc.)
 *
 * Usage:
 *   <ChatInput
 *     value={input}
 *     onChange={(e) => setInput(e.target.value)}
 *     onKeyDown={handleKeyDown}
 *     placeholder="Type a message..."
 *   />
 */

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ChatInputProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const ChatInput = React.forwardRef<HTMLTextAreaElement, ChatInputProps>(
  ({ className, ...props }, ref) => (
    <Textarea
      autoComplete="off"
      ref={ref}
      name="message"
      className={cn(
        "max-h-12 px-4 py-3 bg-background text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 w-full rounded-md flex items-center h-16 resize-none",
        className,
      )}
      {...props}
    />
  ),
);
ChatInput.displayName = "ChatInput";

export { ChatInput };
