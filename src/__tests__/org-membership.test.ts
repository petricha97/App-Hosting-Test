// @vitest-environment node
/**
 * SEC M2 Finding 1 — the server-side tenancy trust boundary.
 * src/lib/org-membership.ts is the single implementation route-scope.ts,
 * get-dashboard-scope.ts and the promotions route share: the client-writable
 * active organizationId is only a valid tenant key when the server-locked
 * organizations[] roster confirms membership. Fail CLOSED on anything else.
 */
import { describe, expect, it } from "vitest";

import {
  findOrganizationMembership,
  isActiveOrganizationMember,
  resolveActiveOrganizationId,
} from "@/lib/org-membership";
import type { OrganizationMembership } from "@/types/collection";

function membership(
  organizationId: string,
  role: OrganizationMembership["role"] = "member",
): OrganizationMembership {
  return {
    organizationId,
    role,
    joinedAt: null as unknown as OrganizationMembership["joinedAt"],
    joinMethod: "invite_code",
  };
}

describe("findOrganizationMembership", () => {
  it("returns the matching roster entry", () => {
    const roster = [membership("org-a"), membership("org-b", "owner")];
    expect(findOrganizationMembership(roster, "org-b")).toMatchObject({
      organizationId: "org-b",
      role: "owner",
    });
  });

  it("returns null for a non-member org, an empty roster, and a missing roster", () => {
    expect(findOrganizationMembership([membership("org-a")], "org-x")).toBeNull();
    expect(findOrganizationMembership([], "org-a")).toBeNull();
    expect(findOrganizationMembership(undefined, "org-a")).toBeNull();
    expect(findOrganizationMembership(null, "org-a")).toBeNull();
  });

  it("fails closed on malformed roster entries (fail closed, never throw)", () => {
    const roster = [
      null,
      "org-a",
      42,
    ] as unknown as OrganizationMembership[];
    expect(findOrganizationMembership(roster, "org-a")).toBeNull();
  });
});

describe("resolveActiveOrganizationId / isActiveOrganizationMember", () => {
  it("resolves the active org when the roster confirms membership", () => {
    const userDoc = {
      organizationId: "org-a",
      organizations: [membership("org-a")],
    };
    expect(isActiveOrganizationMember(userDoc)).toBe(true);
    expect(resolveActiveOrganizationId(userDoc)).toBe("org-a");
  });

  it("returns null when the active org was rewritten to a non-member org (the Finding-1 attack)", () => {
    const userDoc = {
      organizationId: "victim-org",
      organizations: [membership("attacker-org")],
    };
    expect(isActiveOrganizationMember(userDoc)).toBe(false);
    expect(resolveActiveOrganizationId(userDoc)).toBeNull();
  });

  it("returns null for missing user doc, empty active org, or roster-less legacy doc", () => {
    expect(resolveActiveOrganizationId(null)).toBeNull();
    expect(resolveActiveOrganizationId(undefined)).toBeNull();
    expect(
      resolveActiveOrganizationId({
        organizationId: "",
        organizations: [membership("org-a")],
      }),
    ).toBeNull();
    expect(
      resolveActiveOrganizationId({ organizationId: "org-a" }),
    ).toBeNull();
    expect(
      resolveActiveOrganizationId({
        organizationId: "org-a",
        organizations: null,
      }),
    ).toBeNull();
  });
});
