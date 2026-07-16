// @vitest-environment node
/**
 * M6-T4 — write-time Zod validation for `EmailPuckBlock` (spec
 * agents/docs/specs/m6-email-designer.md §2/§3.1 step 2).
 *
 * Locks:
 *  - the discriminated union accepts exactly the 8 allowlisted block types
 *    (each with its own per-type prop shape) and rejects everything else
 *    (spec §2 AC-2);
 *  - imageUrl-typed props reject javascript:/data:/relative/protocol-
 *    relative values, accept "" (no image) and absolute http(s) URLs;
 *  - EMAIL_BODY_BLOCKS_MAX_COUNT (20) and EMAIL_BODY_BLOCKS_MAX_BYTES
 *    (48 KB) are independent, both enforced (spec §2 AC-3);
 *  - the constants are exactly the values documented in the data-model doc.
 */
import { describe, expect, it } from "vitest";

import {
  EMAIL_BODY_BLOCKS_MAX_BYTES,
  EMAIL_BODY_BLOCKS_MAX_COUNT,
  emailBodyBlocksSchema,
  emailPuckBlockSchema,
  emailSafeUrlSchema,
  isEmailSafeUrl,
} from "@/lib/email/schemas";
import { EMAIL_SAFE_BLOCK_TYPES } from "@/types/collection";

function validPropsFor(type: string): Record<string, unknown> {
  switch (type) {
    case "Hero":
      return {
        eyebrow: "Conference",
        heading: "Welcome",
        body: "Join us",
        primaryCtaLabel: "Register",
        secondaryCtaLabel: "Learn more",
        imageUrl: "",
      };
    case "Highlights":
      return {
        title: "Why attend",
        intro: "A few reasons",
        itemOneTitle: "One",
        itemOneBody: "Body one",
        itemTwoTitle: "Two",
        itemTwoBody: "Body two",
        itemThreeTitle: "Three",
        itemThreeBody: "Body three",
      };
    case "Story":
      return {
        title: "Our story",
        body: "Once upon a time",
        imageUrl: "",
        imageSide: "right",
      };
    case "Schedule":
      return { title: "Agenda", agenda: "09:00 Doors open" };
    case "Faq":
      return {
        title: "FAQ",
        questionOne: "Q1",
        answerOne: "A1",
        questionTwo: "Q2",
        answerTwo: "A2",
        questionThree: "Q3",
        answerThree: "A3",
      };
    case "RegistrationEmbed":
      return {
        title: "Save your seat",
        body: "Register today",
        buttonLabel: "Register now",
      };
    case "TicketPricingTable":
      return { title: "Tickets", intro: "", emptyMessage: "" };
    case "CountdownTimer":
      return {
        title: "Event starts in",
        target: "eventStart",
        customDateTime: "",
        completedMessage: "",
      };
    default:
      throw new Error(`no fixture for ${type}`);
  }
}

describe("emailPuckBlockSchema — the 8-entry discriminated union (spec §1 AC-1 / §2 AC-2)", () => {
  it("accepts a minimal valid block for every one of the 8 allowlisted types", () => {
    for (const type of EMAIL_SAFE_BLOCK_TYPES) {
      const result = emailPuckBlockSchema.safeParse({
        id: `block-${type}`,
        type,
        props: validPropsFor(type),
      });
      expect(
        result.success,
        `${type} should parse: ${JSON.stringify(result.success ? null : result.error.issues)}`,
      ).toBe(true);
    }
  });

  it("rejects an unrecognized type string (e.g. the excluded CallToAction) with zero ambiguity", () => {
    const result = emailPuckBlockSchema.safeParse({
      id: "block-1",
      type: "CallToAction",
      props: { title: "x", body: "x", buttonLabel: "x" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a recognized type whose props fail its per-type schema (spec §2 AC-2 example)", () => {
    const result = emailPuckBlockSchema.safeParse({
      id: "block-1",
      type: "Hero",
      props: { ...validPropsFor("Hero"), imageUrl: "javascript:alert(1)" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a block missing a required prop key entirely", () => {
    const result = emailPuckBlockSchema.safeParse({
      id: "block-1",
      type: "Story",
      props: { title: "x", body: "x" }, // missing imageUrl/imageSide
    });
    expect(result.success).toBe(false);
  });
});

describe("isEmailSafeUrl / emailSafeUrlSchema (spec §3.1 step 2 — a SEPARATE control from escaping)", () => {
  it("accepts absolute http(s) URLs", () => {
    expect(isEmailSafeUrl("https://images.example.com/hero.jpg")).toBe(true);
    expect(isEmailSafeUrl("http://images.example.com/hero.jpg")).toBe(true);
  });

  it("rejects javascript:, data:, vbscript:, and file: schemes", () => {
    expect(isEmailSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isEmailSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(
      false,
    );
    expect(isEmailSafeUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isEmailSafeUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects relative paths — there is no 'current page' to resolve against in an inbox", () => {
    expect(isEmailSafeUrl("/foo.png")).toBe(false);
    expect(isEmailSafeUrl("foo.png")).toBe(false);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isEmailSafeUrl("//evil.example.com/x.png")).toBe(false);
  });

  it("rejects empty/whitespace-only strings", () => {
    expect(isEmailSafeUrl("")).toBe(false);
    expect(isEmailSafeUrl("   ")).toBe(false);
  });

  it("emailSafeUrlSchema allows an empty string (the block's 'no image' default) but rejects an unsafe non-empty one", () => {
    expect(emailSafeUrlSchema.safeParse("").success).toBe(true);
    expect(
      emailSafeUrlSchema.safeParse("https://a.example.com/x.jpg").success,
    ).toBe(true);
    expect(emailSafeUrlSchema.safeParse("javascript:alert(1)").success).toBe(
      false,
    );
  });
});

describe("emailBodyBlocksSchema — count and byte caps (spec §2 AC-3)", () => {
  it("exposes the documented constants", () => {
    expect(EMAIL_BODY_BLOCKS_MAX_COUNT).toBe(20);
    expect(EMAIL_BODY_BLOCKS_MAX_BYTES).toBe(48 * 1024);
  });

  it("accepts exactly EMAIL_BODY_BLOCKS_MAX_COUNT blocks and rejects one more", () => {
    const makeBlocks = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `schedule-${i}`,
        type: "Schedule" as const,
        props: { title: "Agenda", agenda: "09:00 Doors" },
      }));

    expect(
      emailBodyBlocksSchema.safeParse(makeBlocks(EMAIL_BODY_BLOCKS_MAX_COUNT))
        .success,
    ).toBe(true);
    expect(
      emailBodyBlocksSchema.safeParse(
        makeBlocks(EMAIL_BODY_BLOCKS_MAX_COUNT + 1),
      ).success,
    ).toBe(false);
  });

  it("rejects a block array whose serialized JSON exceeds EMAIL_BODY_BLOCKS_MAX_BYTES — distinct from the count cap", () => {
    // Two blocks, both individually valid and under the 20-block count cap,
    // but with maxed-out long-text fields so the combined JSON exceeds
    // 48 KB — this must fail on BYTES, not on count.
    const maxedHighlights = {
      id: "highlights-1",
      type: "Highlights" as const,
      props: {
        title: "x".repeat(200),
        intro: "x".repeat(2000),
        itemOneTitle: "x".repeat(200),
        itemOneBody: "x".repeat(2000),
        itemTwoTitle: "x".repeat(200),
        itemTwoBody: "x".repeat(2000),
        itemThreeTitle: "x".repeat(200),
        itemThreeBody: "x".repeat(2000),
      },
    };
    const blocks = Array.from({ length: 6 }, (_, i) => ({
      ...maxedHighlights,
      id: `highlights-${i}`,
    }));
    expect(blocks.length).toBeLessThan(EMAIL_BODY_BLOCKS_MAX_COUNT);
    expect(Buffer.byteLength(JSON.stringify(blocks), "utf8")).toBeGreaterThan(
      EMAIL_BODY_BLOCKS_MAX_BYTES,
    );
    expect(emailBodyBlocksSchema.safeParse(blocks).success).toBe(false);
  });
});
