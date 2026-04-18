/**
 * POST /api/chat
 *
 * Server-side API route that acts as a secure proxy to the OpenAI API.
 * The GPT_API_KEY secret is read from the server environment — it is never
 * exposed to the browser.
 *
 * Request body:  { messages: Array<{ role: "user" | "assistant", content: string }> }
 * Response:      { response: string }  on success
 *                { error: string }     on failure
 */

import { NextResponse } from "next/server";
import { z } from "zod";

/** System prompt injected at the start of every conversation.
 *  Keeps the AI focused on the event management app domain. */
const SYSTEM_PROMPT =
  "You are a helpful AI assistant for this Event Management app. " +
  "You can answer questions about events, bookings, and app features. " +
  "If asked about anything outside the app, politely decline and explain your knowledge is limited to the app.";

/** Zod schema for a single chat message */
const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

/** Zod schema for the full request body — requires at least one message */
const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
});

/** Safely extracts a readable message from an unknown error value */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

export async function POST(req: Request) {
  // Guard: fail fast if the secret was not injected at runtime
  const apiKey = process.env.GPT_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Chat service is not configured" },
      { status: 500 },
    );
  }

  // Validate the incoming request body with Zod
  const body = await req.json();
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    // Forward the conversation to OpenAI, prepending the system prompt
    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...parsed.data.messages,
          ],
        }),
      },
    );

    // Surface OpenAI errors (e.g. rate limit, invalid key) back to the caller
    if (!openaiRes.ok) {
      const err = await openaiRes.json().catch(() => ({}));
      return NextResponse.json(
        {
          error:
            (err as { error?: { message?: string } }).error?.message ??
            "OpenAI request failed",
        },
        { status: openaiRes.status },
      );
    }

    const data = (await openaiRes.json()) as {
      choices?: Array<{ message: { content: string } }>;
    };

    // Sanity check: OpenAI should always return at least one choice
    if (!data.choices?.[0]) {
      return NextResponse.json(
        { error: "Invalid response from OpenAI" },
        { status: 500 },
      );
    }

    return NextResponse.json({ response: data.choices[0].message.content });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
