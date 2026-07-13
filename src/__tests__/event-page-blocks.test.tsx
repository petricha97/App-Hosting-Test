/**
 * M4-T1 — component-level tests for the three registration blocks (review S2).
 * Locks:
 * - AC-16: legacy saved RegistrationEmbed props (no buttonLabel) render the
 *   default "Register now"; 0-paths events keep the legacy inline form.
 * - AC-17: org-authored props containing script tags render as inert literal
 *   TEXT on all three blocks — never as elements.
 * - AC-4/5: sold-out badge and pricing-table empty state.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import { CountdownBlock } from "@/features/event-pages/blocks/countdown";
import { RegistrationCtaCard } from "@/features/event-pages/blocks/registration-cta";
import { TicketPricingTableBlock } from "@/features/event-pages/blocks/ticket-pricing-table";
import { createEventPagePuckConfig } from "@/features/event-pages/puck";
import type { PublicPricingProjection } from "@/features/public-registration/types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const XSS = '<script>alert("xss")</script>';

const PROJECTION: PublicPricingProjection = {
  currencies: ["USD"],
  tickets: [
    {
      name: "General admission",
      code: "GA",
      soldOut: false,
      audienceNames: [],
      prices: [{ currency: "USD", minPriceMinor: 5000, isFrom: false }],
    },
    {
      name: "VIP",
      code: "VIP",
      soldOut: true,
      audienceNames: ["Member"],
      prices: [{ currency: "USD", minPriceMinor: 12000, isFrom: true }],
    },
  ],
} as PublicPricingProjection;

// Renders a block through the same Puck config the pages use.
function renderConfigBlock(
  configOptions: Parameters<typeof createEventPagePuckConfig>[0],
  blockName: string,
  props: Record<string, unknown>,
) {
  const config = createEventPagePuckConfig(configOptions);
  const block = config.components[blockName] as unknown as {
    render: (renderProps: Record<string, unknown>) => ReactElement;
  };
  return render(block.render(props));
}

describe("RegistrationEmbed backward compatibility (AC-16)", () => {
  it("renders the default 'Register now' for legacy saved props without buttonLabel", () => {
    renderConfigBlock(
      {
        registrationCta: {
          state: "open",
          registerHref: "/events/evt-1/register",
          variant: "public",
        },
      },
      "RegistrationEmbed",
      // Legacy doc shape: title/body only.
      { title: "Save your seat", body: "Join us." },
    );

    const cta = screen.getByRole("link", { name: "Register now" });
    expect(cta.getAttribute("href")).toBe("/events/evt-1/register");
    expect(screen.getByText("Save your seat")).toBeTruthy();
    expect(screen.getByText("Join us.")).toBeTruthy();
  });

  it("keeps the legacy inline form branch when the event has never had paths (AC-14)", () => {
    renderConfigBlock(
      { registrationCta: null },
      "RegistrationEmbed",
      { title: "Save your seat", body: "Join us." },
    );

    // The shared placeholder (legacy inline-form surface) renders, no CTA.
    expect(screen.getByText("Registration embed")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Register now" })).toBeNull();
  });

  it("renders script-tag props as inert text, never as elements (AC-17)", () => {
    const { container } = renderConfigBlock(
      {
        registrationCta: {
          state: "open",
          registerHref: "/events/evt-1/register",
          variant: "public",
        },
      },
      "RegistrationEmbed",
      { title: XSS, body: XSS, buttonLabel: XSS },
    );

    expect(container.querySelector("script")).toBeNull();
    // The literal tag text is visible (twice: title + body; once in the CTA).
    expect(screen.getAllByText(XSS).length).toBeGreaterThanOrEqual(3);
  });
});

describe("RegistrationCtaCard states", () => {
  it("closed state renders a non-focusable disabled notice, never a dead link (AC-15)", () => {
    render(
      <RegistrationCtaCard
        title="Register"
        body="Closed for now"
        buttonLabel="Register now"
        state="closed"
        registerHref="/events/evt-1/register"
        variant="public"
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    const disabled = screen.getByText("Register now");
    expect(disabled.tagName).toBe("SPAN");
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("TicketPricingTableBlock (AC-4/5/17)", () => {
  it("shows the sold-out badge per ticket (AC-4)", () => {
    render(
      <TicketPricingTableBlock
        title="Tickets"
        intro=""
        emptyMessage=""
        projection={PROJECTION}
      />,
    );

    // Table + mobile cards each render one badge per ticket.
    expect(screen.getAllByText("Sold out").length).toBe(2);
    expect(screen.getAllByText("Open").length).toBe(2);
    expect(screen.getAllByText("from $120.00").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the empty state for a null projection (AC-5 / AC-8 degrade)", () => {
    render(
      <TicketPricingTableBlock
        title="Tickets"
        intro=""
        emptyMessage="Tickets coming soon."
        projection={null}
      />,
    );

    expect(screen.getByText("Tickets coming soon.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders script-tag props as inert text (AC-17)", () => {
    const { container } = render(
      <TicketPricingTableBlock
        title={XSS}
        intro={XSS}
        emptyMessage={XSS}
        projection={null}
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(screen.getAllByText(XSS).length).toBeGreaterThanOrEqual(2);
  });
});

describe("CountdownBlock (AC-17)", () => {
  it("renders script-tag title/completedMessage as inert text", () => {
    const { container, unmount } = render(
      <CountdownBlock
        title={XSS}
        target="custom"
        customDateTime=""
        completedMessage={XSS}
        eventStartIso={null}
        timezone="UTC"
      />,
    );

    // No resolvable target → static completed message branch.
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getAllByText(XSS).length).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it("never echoes customDateTime into markup or attributes (AC-17)", () => {
    const hostile = '2026-09-15T09:00" onmouseover="alert(1)';
    const { container, unmount } = render(
      <CountdownBlock
        title="Starts in"
        target="custom"
        customDateTime={hostile}
        completedMessage="Started."
        eventStartIso="2099-01-01T00:00:00.000Z"
        timezone="UTC"
      />,
    );

    expect(container.innerHTML).not.toContain("onmouseover");
    // Unparseable custom → event-start fallback; the absolute-target line is
    // the Intl-formatted instant, not the raw prop — on both the visible
    // line and the sr-only fact.
    expect(screen.getByText("January 1, 2099 · 12:00 AM")).toBeTruthy();
    expect(
      screen.getByText("Starts in: January 1, 2099 · 12:00 AM"),
    ).toBeTruthy();
    unmount();
  });
});
