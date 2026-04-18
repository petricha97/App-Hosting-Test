/**
 * ChatSupport
 *
 * The main AI chatbot widget rendered on every page (added in layout.tsx).
 * Appears as a floating circular button in the bottom-right corner.
 * Clicking it opens/closes the chat panel.
 *
 * Features:
 *   - Full conversation history (AI remembers previous messages in the session)
 *   - Animated loading dots while waiting for a response
 *   - Inline error display if the API call fails (conversation is preserved)
 *   - Press Enter to send, Shift+Enter for a new line
 *   - "New Chat" button to clear the conversation and start fresh
 *   - Send button is disabled while loading or if the input is empty
 *
 * Data flow:
 *   User types → handleSend → useChatbot.sendMessage → POST /api/chat
 *   → response appended to messages → re-renders ChatMessageList
 */

"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import {
  ChatBubble,
  ChatBubbleMessage,
} from "@/components/ui/chat/chat-bubble";
import { ChatInput } from "@/components/ui/chat/chat-input";
import {
  ExpandableChat,
  ExpandableChatHeader,
  ExpandableChatBody,
  ExpandableChatFooter,
} from "@/components/ui/chat/expandable-chat";
import { ChatMessageList } from "@/components/ui/chat/chat-message-list";
import { Button } from "@/components/ui/button";
import { useChatbot } from "@/hooks/useChatbot";

export default function ChatSupport() {
  /** Controlled input value for the message textarea */
  const [input, setInput] = useState("");

  const { messages, isLoading, error, sendMessage, clearMessages } =
    useChatbot();

  /** Sends the current input and clears the text field */
  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendMessage(text);
  };

  /** Allows pressing Enter to send (Shift+Enter inserts a newline instead) */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <ExpandableChat size="lg" position="bottom-right">
      {/* Header: title, subtitle, and New Chat button */}
      <ExpandableChatHeader className="flex-col text-center justify-center">
        <h1 className="text-xl font-semibold">Chat with AI ✨</h1>
        <p className="text-sm text-muted-foreground">
          Ask anything about the app
        </p>
        <div className="flex gap-2 items-center pt-2">
          <Button variant="secondary" size="sm" onClick={clearMessages}>
            New Chat
          </Button>
        </div>
      </ExpandableChatHeader>

      {/* Body: scrollable message list */}
      <ExpandableChatBody>
        <ChatMessageList>
          {/* Empty state shown before any messages are sent */}
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center mt-4">
              How can I help you today?
            </p>
          )}

          {/* Render each message as a bubble aligned left (AI) or right (user) */}
          {messages.map((msg, i) => (
            <ChatBubble
              key={i}
              variant={msg.role === "user" ? "sent" : "received"}
            >
              <ChatBubbleMessage
                variant={msg.role === "user" ? "sent" : "received"}
              >
                {msg.content}
              </ChatBubbleMessage>
            </ChatBubble>
          ))}

          {/* Typing indicator — shown while waiting for the AI response */}
          {isLoading && (
            <ChatBubble variant="received">
              <ChatBubbleMessage variant="received" isLoading />
            </ChatBubble>
          )}

          {/* Error message shown inline if the API call fails */}
          {error && (
            <p className="text-sm text-destructive text-center px-4">{error}</p>
          )}
        </ChatMessageList>
      </ExpandableChatBody>

      {/* Footer: text input and send button */}
      <ExpandableChatFooter>
        <div className="flex gap-2 items-end">
          <ChatInput
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything about the app..."
            disabled={isLoading}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </ExpandableChatFooter>
    </ExpandableChat>
  );
}
