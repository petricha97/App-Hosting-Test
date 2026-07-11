/**
 * M5-T1 — confirmation QR retrofit (spec T1 AC-7, design §4):
 * - a FinalizeSuccess carrying qrSvg renders the real entry-pass QR on the
 *   white backing panel as CONTENT (role="img" + accessible label) — the SVG
 *   markup is exactly what the server sent (the token-only payload itself is
 *   asserted at the finalize-route test against the qrcode encoder);
 * - a legacy payload WITHOUT qrSvg keeps the dashed placeholder + old copy;
 * - the wallet buttons are visual placeholders: disabled, wrapped in
 *   keyboard-reachable tooltip spans (tabIndex 0 + aria-describedby).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConfirmationStep } from "@/features/public-registration/components/confirmation-step";
import type { FinalizeSuccess } from "@/features/public-registration/types";

const QR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><path stroke="#000" d="M0 0h7"/></svg>';

function makeResult(overrides: Partial<FinalizeSuccess> = {}): FinalizeSuccess {
  return {
    registrationRef: "a1b2c3d4e5f6",
    orderRef: "order-abcdef123456",
    paymentStatus: "paid",
    amounts: {
      subtotalMinor: 5000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 5000,
    },
    currency: "USD",
    ...overrides,
  };
}

describe("ConfirmationStep — QR rendering", () => {
  it("renders the server SVG as an accessible image on the white backing panel", () => {
    render(<ConfirmationStep result={makeResult({ qrSvg: QR_SVG })} />);

    const qr = screen.getByRole("img", { name: "Your entry QR code" });
    expect(qr).toBeTruthy();
    // The markup is the server's SVG, injected verbatim.
    expect(qr.innerHTML).toContain('viewBox="0 0 29 29"');
    expect(qr.querySelector("svg")).not.toBeNull();
    // White backing + padding = the scannable quiet zone (design §4).
    expect(qr.className).toContain("bg-white");
    expect(qr.className).toContain("p-3");

    expect(
      screen.getByText(
        "Show this QR at the door — it's also in your confirmation email.",
      ),
    ).toBeTruthy();
  });

  it("falls back to the dashed placeholder when qrSvg is absent (legacy payloads)", () => {
    render(<ConfirmationStep result={makeResult()} />);

    expect(
      screen.queryByRole("img", { name: "Your entry QR code" }),
    ).toBeNull();
    expect(
      screen.getByText(
        "Your QR code will appear here and in your confirmation email.",
      ),
    ).toBeTruthy();
  });

  it("keeps the reference block in both variants", () => {
    render(<ConfirmationStep result={makeResult({ qrSvg: QR_SVG })} />);
    expect(screen.getByText("REG-A1B2C3D4")).toBeTruthy();
    expect(screen.getByText("Your entry pass")).toBeTruthy();
  });
});

describe("ConfirmationStep — wallet placeholders (Q4)", () => {
  it("renders both wallet buttons disabled inside keyboard-reachable tooltip wrappers", () => {
    render(<ConfirmationStep result={makeResult({ qrSvg: QR_SVG })} />);

    const apple = screen.getByRole("button", { name: "Add to Apple Wallet" });
    const google = screen.getByRole("button", { name: "Add to Google Wallet" });

    for (const button of [apple, google]) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      const wrapper = button.closest("span[tabindex='0']");
      expect(wrapper).not.toBeNull();
      expect(wrapper?.getAttribute("aria-describedby")).toBe(
        "wallet-coming-soon",
      );
    }

    // The mirrored description text exists for assistive tech.
    expect(
      document.getElementById("wallet-coming-soon")?.textContent,
    ).toContain("Wallet passes are coming soon.");
  });
});
