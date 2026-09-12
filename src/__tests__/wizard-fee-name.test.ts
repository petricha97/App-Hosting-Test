/**
 * M9-T1 — generateWizardFeeName truncation boundary tests.
 * Spec: agents/docs/specs/m9-ticket-wizard.md §4.3.
 *
 * Pure function, no mocks needed (no Firebase import in the module under
 * test) — safe to run in either the default or node vitest environment.
 */
import { describe, expect, it } from "vitest";

import {
  generateWizardFeeName,
  WIZARD_ALL_REGISTRATION_TYPES_LABEL,
} from "@/lib/fees/wizard-fee-name";

describe("generateWizardFeeName", () => {
  it("builds the plain 'ticket — regType (currency)' shape when it fits", () => {
    expect(generateWizardFeeName("GC Early Bird", "Delegate", "USD")).toBe(
      "GC Early Bird — Delegate (USD)",
    );
  });

  it("uses the 'All types' label for the null-audience row", () => {
    expect(
      generateWizardFeeName(
        "GC Early Bird",
        WIZARD_ALL_REGISTRATION_TYPES_LABEL,
        "USD",
      ),
    ).toBe("GC Early Bird — All types (USD)");
  });

  it("never exceeds 80 characters, even for very long names", () => {
    const ticketName = "A".repeat(60);
    const regTypeLabel = "B".repeat(60);

    const name = generateWizardFeeName(ticketName, regTypeLabel, "USD");

    expect(name.length).toBeLessThanOrEqual(80);
  });

  it("preserves the exact currency suffix under truncation, never drops or shortens it", () => {
    const ticketName = "A".repeat(60);
    const regTypeLabel = "B".repeat(60);

    const name = generateWizardFeeName(ticketName, regTypeLabel, "GBP");

    expect(name.endsWith(" (GBP)")).toBe(true);
  });

  it("does not truncate a string that lands exactly at the 80-char boundary", () => {
    // "X".repeat(37) + " — " (3) + "Y".repeat(34) + " (USD)" (6) == 80 exactly.
    const ticketName = "X".repeat(37);
    const regTypeLabel = "Y".repeat(34);
    const expected = `${ticketName} — ${regTypeLabel} (USD)`;
    expect(expected.length).toBe(80);

    const name = generateWizardFeeName(ticketName, regTypeLabel, "USD");

    expect(name).toBe(expected);
    expect(name.length).toBe(80);
  });

  it("truncates a string exactly one character past the 80-char boundary", () => {
    const ticketName = "X".repeat(38); // one char longer than the boundary case above
    const regTypeLabel = "Y".repeat(34);
    const full = `${ticketName} — ${regTypeLabel} (USD)`;
    expect(full.length).toBe(81);

    const name = generateWizardFeeName(ticketName, regTypeLabel, "USD");

    expect(name.length).toBe(80);
    expect(name.endsWith(" (USD)")).toBe(true);
    // The truncated portion is a prefix of the original name portion (minus
    // any trailing-whitespace trim), never the suffix.
    const namePortionUsed = name.slice(0, name.length - " (USD)".length);
    expect(`${ticketName} — ${regTypeLabel}`.startsWith(namePortionUsed)).toBe(
      true,
    );
  });

  it("differentiates two currencies of the same ticket/regType pair after truncation (the invariant the suffix protects)", () => {
    const ticketName = "A".repeat(70);
    const regTypeLabel = "B".repeat(70);

    const usd = generateWizardFeeName(ticketName, regTypeLabel, "USD");
    const gbp = generateWizardFeeName(ticketName, regTypeLabel, "GBP");

    expect(usd).not.toBe(gbp);
    expect(usd.endsWith(" (USD)")).toBe(true);
    expect(gbp.endsWith(" (GBP)")).toBe(true);
  });

  it("handles non-ASCII names without exceeding the bound", () => {
    const ticketName = "早鸟票".repeat(10);
    const regTypeLabel = "代表团".repeat(10);

    const name = generateWizardFeeName(ticketName, regTypeLabel, "SGD");

    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith(" (SGD)")).toBe(true);
  });

  it("trims trailing whitespace left by a mid-word truncation cut", () => {
    // Craft a name portion where the truncation boundary lands just after a
    // space, so the naive slice would leave a dangling " " before the
    // suffix without the trimEnd() step.
    const ticketName = "Word ".repeat(20); // 100 chars, lots of spaces
    const name = generateWizardFeeName(ticketName, "Delegate", "EUR");

    expect(name.includes("  ")).toBe(false); // no doubled space from the cut
    expect(name).not.toContain(" (EUR)".repeat(2));
    expect(name.endsWith(" (EUR)")).toBe(true);
  });
});
