/**
 * useChatbot
 *
 * Custom hook that manages the full state of the AI chat conversation.
 * Handles sending messages, tracking loading/error state, and maintaining
 * the conversation history so the AI has context from previous messages.
 *
 * How it works:
 *   1. User calls sendMessage("Hello")
 *   2. The user message is appended to `messages` immediately (optimistic)
 *   3. The full conversation history is POSTed to /api/chat
 *   4. The AI response is appended to `messages` on success
 *   5. If the request fails, `error` is set with the reason
 *
 * @returns messages      - Array of all messages in the conversation
 * @returns isLoading     - True while waiting for the AI response
 * @returns error         - Error message string if the last request failed, otherwise null
 * @returns sendMessage   - Call with the user's text to send a new message
 * @returns clearMessages - Resets the conversation back to empty
 */

import { useState, useCallback } from "react";

/** Represents a single message in the conversation */
interface Message {
  role: "user" | "assistant";
  content: string;
}

interface UseChatbotReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

export function useChatbot(): UseChatbotReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      // Build the next message list with the user's message appended
      const userMessage: Message = { role: "user", content };
      const nextMessages = [...messages, userMessage];

      // Update UI immediately so the user sees their message right away
      setMessages(nextMessages);
      setIsLoading(true);
      setError(null);

      try {
        // Send the full conversation history so the AI has context
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: nextMessages }),
        });

        const data = (await res.json()) as {
          response?: string;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error ?? "Failed to get response");
        }

        // Append the AI response to the conversation
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.response ?? "" },
        ]);
      } catch (err: unknown) {
        // Show the error in the chat — conversation history is preserved
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setIsLoading(false);
      }
    },
    [messages],
  );

  /** Clears all messages and resets error state (used by "New Chat" button) */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, isLoading, error, sendMessage, clearMessages };
}
