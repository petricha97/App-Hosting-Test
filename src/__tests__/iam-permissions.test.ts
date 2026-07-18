/**
 * M8-T1 — pure role-hierarchy helpers (spec D10). Table-driven, no mocks:
 * these are the exact hierarchy rules every mutating IAM route re-checks
 * server-side (Backend's DAL) and the dialogs mirror client-side (design §2/
 * §3). Spec §1 AC-1's permission-matrix assertion belongs to Backend's own
 * permissionsForOrganizationRole() suite — this file only locks the
 * role-hierarchy guardrail, which is orthogonal to the UserPermission
 * strings (D5).
 */
import { describe, expect, it } from "vitest";

import {
  assignableRoles,
  canAssignRole,
  canChangeRole,
  canInviteRole,
  canManageTargetRole,
  invitableRoles,
  isOwnerTierRoleChange,
  normalizeOrgRole,
  roleLabel,
  roleRank,
} from "@/features/iam/permissions";
import type { OrgRole } from "@/features/iam/types";

describe("normalizeOrgRole (D2 — legacy 'member' alias)", () => {
  it("aliases legacy 'member' to 'viewer'", () => {
    expect(normalizeOrgRole("member")).toBe("viewer");
  });

  it.each(["owner", "admin", "editor", "viewer"] as const)(
    "passes through the real role '%s' unchanged",
    (role) => {
      expect(normalizeOrgRole(role)).toBe(role);
    },
  );

  it("fails closed to 'viewer' for unknown/malformed input", () => {
    expect(normalizeOrgRole("bogus")).toBe("viewer");
    expect(normalizeOrgRole(null)).toBe("viewer");
    expect(normalizeOrgRole(undefined)).toBe("viewer");
  });
});

describe("roleRank / roleLabel", () => {
  it("ranks Owner > Admin > Editor > Viewer", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("admin"));
    expect(roleRank("admin")).toBeGreaterThan(roleRank("editor"));
    expect(roleRank("editor")).toBeGreaterThan(roleRank("viewer"));
  });

  it("title-cases the role for display", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("viewer")).toBe("Viewer");
  });
});

describe("canManageTargetRole (D10 — who a caller may act on at all)", () => {
  it.each(["owner", "admin", "editor", "viewer"] as const)(
    "an Owner may act on a %s-role target",
    (target) => {
      expect(canManageTargetRole("owner", target)).toBe(true);
    },
  );

  it("an Admin may act on Editor/Viewer targets", () => {
    expect(canManageTargetRole("admin", "editor")).toBe(true);
    expect(canManageTargetRole("admin", "viewer")).toBe(true);
  });

  it("an Admin cannot act on an Owner or Admin row AT ALL", () => {
    expect(canManageTargetRole("admin", "owner")).toBe(false);
    expect(canManageTargetRole("admin", "admin")).toBe(false);
  });

  it("Editor/Viewer callers can never act on anyone (coarse write:user gate handles this too, belt-and-suspenders)", () => {
    (["owner", "admin", "editor", "viewer"] as const).forEach((target) => {
      expect(canManageTargetRole("editor", target)).toBe(false);
      expect(canManageTargetRole("viewer", target)).toBe(false);
    });
  });
});

describe("canAssignRole (D10 — what a caller may set the NEW role to)", () => {
  it("an Owner may assign any role", () => {
    (["owner", "admin", "editor", "viewer"] as const).forEach((role) => {
      expect(canAssignRole("owner", role)).toBe(true);
    });
  });

  it("an Admin may only assign editor/viewer — never admin/owner", () => {
    expect(canAssignRole("admin", "editor")).toBe(true);
    expect(canAssignRole("admin", "viewer")).toBe(true);
    expect(canAssignRole("admin", "admin")).toBe(false);
    expect(canAssignRole("admin", "owner")).toBe(false);
  });
});

describe("canChangeRole (combined route-level gate)", () => {
  it("an Owner promoting an Editor to Admin succeeds (spec §5 AC-1)", () => {
    expect(canChangeRole("owner", "editor", "admin")).toBe(true);
  });

  it("an Owner demoting an Admin to Editor succeeds (spec §5 AC-1)", () => {
    expect(canChangeRole("owner", "admin", "editor")).toBe(true);
  });

  it("an Admin changing another Admin's or Owner's row is rejected regardless of the requested role (spec §5 AC-2)", () => {
    expect(canChangeRole("admin", "admin", "editor")).toBe(false);
    expect(canChangeRole("admin", "owner", "viewer")).toBe(false);
  });

  it("an Admin promoting an Editor/Viewer TO admin or owner is rejected (spec §5 AC-2)", () => {
    expect(canChangeRole("admin", "editor", "admin")).toBe(false);
    expect(canChangeRole("admin", "viewer", "owner")).toBe(false);
  });

  it("an Admin changing an Editor<->Viewer row succeeds", () => {
    expect(canChangeRole("admin", "editor", "viewer")).toBe(true);
    expect(canChangeRole("admin", "viewer", "editor")).toBe(true);
  });
});

describe("canInviteRole (D10 — invite-role ceiling)", () => {
  it("an Owner may invite as admin/editor/viewer", () => {
    expect(canInviteRole("owner", "admin")).toBe(true);
    expect(canInviteRole("owner", "editor")).toBe(true);
    expect(canInviteRole("owner", "viewer")).toBe(true);
  });

  it("an Admin may invite as editor/viewer but NOT admin (spec §3 AC-4)", () => {
    expect(canInviteRole("admin", "editor")).toBe(true);
    expect(canInviteRole("admin", "viewer")).toBe(true);
    expect(canInviteRole("admin", "admin")).toBe(false);
  });
});

describe("isOwnerTierRoleChange (design §3 — dialog escalation)", () => {
  it("Editor<->Viewer changes are NOT owner-tier (lightweight Dialog)", () => {
    expect(isOwnerTierRoleChange("editor", "viewer")).toBe(false);
    expect(isOwnerTierRoleChange("viewer", "editor")).toBe(false);
    expect(isOwnerTierRoleChange("editor", "editor")).toBe(false);
  });

  it("anything promoting into or demoting out of Owner/Admin escalates to AlertDialog", () => {
    expect(isOwnerTierRoleChange("editor", "admin")).toBe(true);
    expect(isOwnerTierRoleChange("editor", "owner")).toBe(true);
    expect(isOwnerTierRoleChange("admin", "editor")).toBe(true);
    expect(isOwnerTierRoleChange("owner", "admin")).toBe(true);
    expect(isOwnerTierRoleChange("admin", "owner")).toBe(true);
  });
});

describe("assignableRoles / invitableRoles (options omitted, not disabled)", () => {
  it("an Owner sees all 4 roles as assignable, and admin/editor/viewer as invitable", () => {
    expect(assignableRoles("owner")).toEqual([
      "owner",
      "admin",
      "editor",
      "viewer",
    ]);
    expect(invitableRoles("owner")).toEqual(["admin", "editor", "viewer"]);
  });

  it("an Admin sees only editor/viewer for both assignable and invitable roles", () => {
    expect(assignableRoles("admin")).toEqual(["editor", "viewer"]);
    expect(invitableRoles("admin")).toEqual(["editor", "viewer"]);
  });

  it("Editor/Viewer callers have no assignable/invitable roles (UI never reaches them anyway)", () => {
    (["editor", "viewer"] as OrgRole[]).forEach((role) => {
      expect(assignableRoles(role)).toEqual([]);
      expect(invitableRoles(role)).toEqual([]);
    });
  });
});
