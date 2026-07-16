// @vitest-environment node
/**
 * M6-T4 — per-block HTML renderers (src/features/emails/server/blocks/*).
 * Spec agents/docs/specs/m6-email-designer.md §1/§3. This is THE
 * security-critical surface of the ticket — "treat with WYSIWYG-editor-XSS-
 * review rigor" (spec §3.2).
 *
 * Locks:
 *  - §3 AC-1: every text-bearing prop of every one of the 8 block types
 *    renders XSS payloads as escaped literal text — exhaustive, not
 *    spot-checked;
 *  - §3 AC-2: javascript:/data:/relative imageUrl values are rejected for
 *    Hero AND Story (never reach a src= attribute);
 *  - §1 AC-3: Hero's CTA labels are stored-but-never-rendered;
 *  - §1 AC-4: Story's imageSide controls order, never a 2-column layout;
 *  - §1 AC-5: RegistrationEmbed's open/closed/zero-paths branches;
 *  - §1 AC-7: CountdownTimer never renders ticking-tile markup.
 */
import { describe, expect, it } from "vitest";

import { renderEmailBlockHtml } from "@/features/emails/server/blocks";
import { escapeHtml } from "@/lib/email/merge-tags";
import type { EmailBlockRenderContext } from "@/features/emails/server/blocks";
import { EMAIL_SAFE_BLOCK_TYPES } from "@/types/collection";
import type { EmailPuckBlock } from "@/types/collection";

const XSS_PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '"><svg onload=alert(1)>',
];

function block(
  type: EmailPuckBlock["type"],
  props: Record<string, unknown>,
): EmailPuckBlock {
  return { id: `${type}-under-test`, type, props };
}

function renderHtml(
  b: EmailPuckBlock,
  context: EmailBlockRenderContext = {},
): string {
  const html = renderEmailBlockHtml(b, context);
  expect(html, `${b.type} should render, not be skipped`).not.toBeNull();
  return html as string;
}

// Mirrors the established repo pattern (email-render-pipeline.test.ts): the
// payload must never appear as RAW markup, and must instead survive as its
// escaped literal-text form (`escapeHtml`'s exact output — the same
// function every block renderer imports, never reimplemented). A substring
// like "onload=alert(1)" surviving as INERT TEXT inside an escaped
// `&lt;svg onload=alert(1)&gt;` run is expected and safe — what matters is
// that the surrounding `<`/`>`/`"` are gone, so no real tag/attribute is
// ever formed.
function expectPayloadEscaped(html: string, payload: string) {
  expect(html).not.toContain(payload);
  expect(html).not.toContain("<script>");
  expect(html).not.toMatch(/<svg[ >]/);
  expect(html).not.toMatch(/<img[^>]*onerror=/);
  expect(html).toContain(escapeHtml(payload));
}

describe("XSS payloads render as escaped literal text — exhaustive across every text-bearing prop of every block (spec §3 AC-1)", () => {
  for (const payload of XSS_PAYLOADS) {
    describe(`payload: ${payload}`, () => {
      it("Hero — eyebrow/heading/body", () => {
        const html = renderHtml(
          block("Hero", {
            eyebrow: payload,
            heading: payload,
            body: payload,
            primaryCtaLabel: payload,
            secondaryCtaLabel: payload,
            imageUrl: "",
          }),
        );
        expectPayloadEscaped(html, payload);
      });

      it("Highlights — title/intro/all 3 items", () => {
        const html = renderHtml(
          block("Highlights", {
            title: payload,
            intro: payload,
            itemOneTitle: payload,
            itemOneBody: payload,
            itemTwoTitle: payload,
            itemTwoBody: payload,
            itemThreeTitle: payload,
            itemThreeBody: payload,
          }),
        );
        expectPayloadEscaped(html, payload);
      });

      it("Story — title/body", () => {
        const html = renderHtml(
          block("Story", {
            title: payload,
            body: payload,
            imageUrl: "",
            imageSide: "right",
          }),
        );
        expectPayloadEscaped(html, payload);
      });

      it("Schedule — title/agenda", () => {
        const html = renderHtml(
          block("Schedule", { title: payload, agenda: payload }),
        );
        expectPayloadEscaped(html, payload);
      });

      it("Faq — title/all 3 Q&A pairs", () => {
        const html = renderHtml(
          block("Faq", {
            title: payload,
            questionOne: payload,
            answerOne: payload,
            questionTwo: payload,
            answerTwo: payload,
            questionThree: payload,
            answerThree: payload,
          }),
        );
        expectPayloadEscaped(html, payload);
      });

      it("RegistrationEmbed — title/body/buttonLabel (all 3 context branches)", () => {
        const props = { title: payload, body: payload, buttonLabel: payload };
        for (const context of [
          undefined,
          { registrationCta: { state: "closed" as const, registerHref: "" } },
          {
            registrationCta: {
              state: "open" as const,
              registerHref: "https://example.com/events/evt-1/register",
            },
          },
        ]) {
          const html = renderHtml(block("RegistrationEmbed", props), context);
          expectPayloadEscaped(html, payload);
        }
      });

      it("TicketPricingTable — title/intro/emptyMessage", () => {
        const html = renderHtml(
          block("TicketPricingTable", {
            title: payload,
            intro: payload,
            emptyMessage: payload,
          }),
        );
        expectPayloadEscaped(html, payload);
      });

      it("CountdownTimer — title/completedMessage", () => {
        const html = renderHtml(
          block("CountdownTimer", {
            title: payload,
            target: "eventStart",
            customDateTime: "",
            completedMessage: payload,
          }),
        );
        expectPayloadEscaped(html, payload);
      });
    });
  }

  it("covers all 8 allowlisted types (guards against a silently-skipped type in this suite)", () => {
    const covered = [
      "Hero",
      "Highlights",
      "Story",
      "Schedule",
      "Faq",
      "RegistrationEmbed",
      "TicketPricingTable",
      "CountdownTimer",
    ];
    expect(covered.sort()).toEqual([...EMAIL_SAFE_BLOCK_TYPES].sort());
  });
});

describe("imageUrl scheme rejection — Hero and Story (spec §3 AC-2)", () => {
  const unsafeUrls = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "/foo.png",
    "foo.png",
    "//evil.example.com/x.png",
  ];

  for (const unsafeUrl of unsafeUrls) {
    it(`Hero drops an unsafe imageUrl (${unsafeUrl}) — never reaches src=`, () => {
      const html = renderHtml(
        block("Hero", {
          eyebrow: "",
          heading: "Welcome",
          body: "",
          primaryCtaLabel: "",
          secondaryCtaLabel: "",
          imageUrl: unsafeUrl,
        }),
      );
      expect(html).not.toContain("<img");
      expect(html).not.toContain(unsafeUrl);
    });

    it(`Story drops an unsafe imageUrl (${unsafeUrl}) — never reaches src=`, () => {
      const html = renderHtml(
        block("Story", {
          title: "Our story",
          body: "",
          imageUrl: unsafeUrl,
          imageSide: "right",
        }),
      );
      expect(html).not.toContain("<img");
      expect(html).not.toContain(unsafeUrl);
    });
  }

  it("Hero renders a safe absolute https imageUrl as a quoted <img src>", () => {
    const html = renderHtml(
      block("Hero", {
        eyebrow: "",
        heading: "Welcome",
        body: "",
        primaryCtaLabel: "",
        secondaryCtaLabel: "",
        imageUrl: "https://images.example.com/hero.jpg",
      }),
    );
    expect(html).toContain('src="https://images.example.com/hero.jpg"');
  });
});

describe("Hero — CTA labels are round-trip-storage-only, never rendered (spec §1 AC-3)", () => {
  it("neither CTA label string appears anywhere in the rendered HTML", () => {
    const html = renderHtml(
      block("Hero", {
        eyebrow: "",
        heading: "Welcome",
        body: "",
        primaryCtaLabel: "UNIQUE_PRIMARY_LABEL_TOKEN",
        secondaryCtaLabel: "UNIQUE_SECONDARY_LABEL_TOKEN",
        imageUrl: "",
      }),
    );
    expect(html).not.toContain("UNIQUE_PRIMARY_LABEL_TOKEN");
    expect(html).not.toContain("UNIQUE_SECONDARY_LABEL_TOKEN");
  });
});

describe("Story — imageSide controls reading order, never a 2-column layout (spec §1 AC-4)", () => {
  it("imageSide=left renders the image before the text", () => {
    const html = renderHtml(
      block("Story", {
        title: "Our story",
        body: "Body copy",
        imageUrl: "https://images.example.com/story.jpg",
        imageSide: "left",
      }),
    );
    const imgIndex = html.indexOf("<img");
    const textIndex = html.indexOf("Our story");
    expect(imgIndex).toBeGreaterThan(-1);
    expect(imgIndex).toBeLessThan(textIndex);
  });

  it("imageSide=right renders the text before the image", () => {
    const html = renderHtml(
      block("Story", {
        title: "Our story",
        body: "Body copy",
        imageUrl: "https://images.example.com/story.jpg",
        imageSide: "right",
      }),
    );
    const imgIndex = html.indexOf("<img");
    const textIndex = html.indexOf("Our story");
    expect(textIndex).toBeLessThan(imgIndex);
  });

  it("never emits a 2-column grid/flex layout marker", () => {
    const html = renderHtml(
      block("Story", {
        title: "Our story",
        body: "Body",
        imageUrl: "",
        imageSide: "left",
      }),
    );
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
    expect(html).not.toMatch(/float:/);
  });
});

describe("RegistrationEmbed — open/closed/zero-paths branches (spec §1 AC-5)", () => {
  const props = {
    title: "Save your seat",
    body: "Register today",
    buttonLabel: "Register now",
  };

  it("open: renders a real absolute-URL <a href> button, no <form>", () => {
    const html = renderHtml(block("RegistrationEmbed", props), {
      registrationCta: {
        state: "open",
        registerHref: "https://app.example.com/events/evt-1/register",
      },
    });
    expect(html).toContain(
      'href="https://app.example.com/events/evt-1/register"',
    );
    expect(html).toMatch(/<a\s/);
    expect(html).not.toContain("<form");
  });

  it("closed: renders a disabled notice, no href, no <form>", () => {
    const html = renderHtml(block("RegistrationEmbed", props), {
      registrationCta: { state: "closed", registerHref: "" },
    });
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<form");
    expect(html).toContain("Registration is currently closed");
  });

  it("zero paths (no context): renders the static notice pointing at {event_url}, no <form>", () => {
    const html = renderHtml(block("RegistrationEmbed", props));
    expect(html).toContain("{event_url}");
    expect(html).not.toContain("<form");
  });

  it("an 'open' context whose registerHref fails URL-scheme validation falls back to a safe non-crashing state (defense in depth)", () => {
    const html = renderHtml(block("RegistrationEmbed", props), {
      registrationCta: { state: "open", registerHref: "javascript:alert(1)" },
    });
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).not.toContain("<form");
  });
});

describe("TicketPricingTable — empty state and freshness snapshot behavior (spec §1 AC-6/AC-9)", () => {
  const props = { title: "Tickets", intro: "", emptyMessage: "" };

  it("renders the empty-state message when no pricing context is supplied", () => {
    const html = renderHtml(block("TicketPricingTable", props));
    expect(html).toContain("Tickets will be announced soon.");
  });

  it("renders the exact rows/prices of whatever snapshot it is handed — a later, DIFFERENT snapshot renders DIFFERENT output (freshness divergence, spec §1 AC-9)", () => {
    const snapshotA = {
      currencies: ["USD" as const],
      tickets: [
        {
          name: "General Admission",
          code: "GA",
          soldOut: false,
          audienceNames: [],
          prices: [
            { currency: "USD" as const, minPriceMinor: 5000, isFrom: false },
          ],
        },
      ],
    };
    const snapshotB = {
      ...snapshotA,
      tickets: [
        {
          ...snapshotA.tickets[0],
          prices: [
            { currency: "USD" as const, minPriceMinor: 7500, isFrom: false },
          ],
        },
      ],
    };

    const htmlA = renderHtml(block("TicketPricingTable", props), {
      pricing: snapshotA,
    });
    const htmlB = renderHtml(block("TicketPricingTable", props), {
      pricing: snapshotB,
    });

    expect(htmlA).toContain("$50.00");
    expect(htmlB).toContain("$75.00");
    expect(htmlA).not.toContain("$75.00");
  });

  it("escapes ticket name/code even though they come from Firestore data, not a block prop", () => {
    const html = renderHtml(block("TicketPricingTable", props), {
      pricing: {
        currencies: ["USD"],
        tickets: [
          {
            name: "<script>alert(1)</script>",
            code: "GA",
            soldOut: false,
            audienceNames: [],
            prices: [{ currency: "USD", minPriceMinor: 1000, isFrom: false }],
          },
        ],
      },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("CountdownTimer — static snapshot only, never ticking tiles (spec §1 AC-7)", () => {
  it("renders no ticking-tile markup (no digit:digit unit pattern) and does contain a formatted absolute date for a future target", () => {
    const futureIso = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const html = renderHtml(
      block("CountdownTimer", {
        title: "Event starts in",
        target: "eventStart",
        customDateTime: "",
        completedMessage: "",
      }),
      { countdown: { eventStartIso: futureIso, timezone: "America/New_York" } },
    );
    // No ticking-tile unit labels (the web block's four unit spans) and no
    // digit-unit pattern like the tile digits would produce — the
    // colon-separated CLOCK TIME inside the formatted absolute date (e.g.
    // "5:37 PM") is expected and is NOT a ticking tile, so this only checks
    // for the tile LABELS, not a blanket digit:digit ban.
    expect(html).not.toContain("Days");
    expect(html).not.toContain("Hrs");
    expect(html).not.toContain("Min");
    expect(html).not.toContain("Sec");
    expect(html).toMatch(/\p{L}+ \d{1,2}, \d{4}/u); // "Month D, YYYY"
  });

  it("renders completedMessage for a target already in the past", () => {
    const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const html = renderHtml(
      block("CountdownTimer", {
        title: "Event starts in",
        target: "eventStart",
        customDateTime: "",
        completedMessage: "The doors are open!",
      }),
      { countdown: { eventStartIso: pastIso, timezone: "UTC" } },
    );
    expect(html).toContain("The doors are open!");
  });

  it("renders the default completedMessage when no target is resolvable at all (no context, no custom date)", () => {
    const html = renderHtml(
      block("CountdownTimer", {
        title: "Event starts in",
        target: "eventStart",
        customDateTime: "",
        completedMessage: "",
      }),
    );
    expect(html).toContain("The event has started.");
  });
});

describe("Unknown block type — skipped, never crashed (spec §1 AC-8)", () => {
  it("renderEmailBlockHtml returns null for a type outside the allowlist", () => {
    const legacyBlock = {
      id: "cta-1",
      type: "CallToAction",
      props: { title: "x", body: "x", buttonLabel: "x" },
    } as unknown as EmailPuckBlock;

    expect(() => renderEmailBlockHtml(legacyBlock)).not.toThrow();
    expect(renderEmailBlockHtml(legacyBlock)).toBeNull();
  });
});
