// @vitest-environment node
/**
 * M8-T1 — src/lib/db/adminOrganizationMember.ts (the D12 reverse-index).
 * Spec: agents/docs/specs/m8-real-iam.md D12/§7.
 *
 * Locks:
 *  - the deterministic doc id is organizationId + "_" + lowercased email
 *  - putAdminOrganizationMemberInTransaction is a full overwrite
 *    (create-or-replace), never a merge that could leave stale fields
 *  - listAdminOrganizationMembers only returns THIS org's rows
 *    (cross-org isolation, spec §7 AC-1)
 *  - countAdminOrganizationOwners(InTransaction) only counts role === "owner"
 *    rows for the given org
 *  - deleteAdminOrganizationMemberInTransaction removes exactly one row
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "firebase-admin/firestore";

import { createFakeAdminDb } from "./helpers/fake-admin-db";

const fake = createFakeAdminDb();
vi.mock("@/app/lib/firestore", () => ({ adminDb: fake.db }));

// The fake's tx object is structurally narrower than the real Admin SDK
// Transaction type (it implements exactly what this repo's DAL code calls,
// nothing more) — cast the entrypoint once here so every call site below can
// pass the fake tx straight into functions typed `tx: Transaction`, matching
// how production code type-checks against the REAL Firestore type while
// running against the fake at test time.
const db = fake.db as unknown as {
  runTransaction: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
};

const {
  organizationMemberId,
  putAdminOrganizationMemberInTransaction,
  deleteAdminOrganizationMemberInTransaction,
  getAdminOrganizationMember,
  listAdminOrganizationMembers,
  countAdminOrganizationOwners,
  countAdminOrganizationOwnersInTransaction,
} = await import("@/lib/db/adminOrganizationMember");

const ORG_A = "org-a";
const ORG_B = "org-b";

beforeEach(() => {
  fake.reset();
});

describe("organizationMemberId", () => {
  it("is deterministic: organizationId + '_' + lowercased email", () => {
    expect(organizationMemberId(ORG_A, "Alice@Example.com")).toBe(
      `${ORG_A}_alice@example.com`,
    );
  });
});

describe("putAdminOrganizationMemberInTransaction", () => {
  it("writes a row readable via getAdminOrganizationMember", async () => {
    await db.runTransaction(async (tx) => {
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: ORG_A,
        email: "Alice@Example.com",
        role: "owner",
        name: "Alice Owner",
        status: "active",
      });
    });

    const row = await getAdminOrganizationMember(ORG_A, "alice@example.com");
    expect(row).toEqual({
      id: `${ORG_A}_alice@example.com`,
      organizationId: ORG_A,
      email: "alice@example.com",
      role: "owner",
      name: "Alice Owner",
      status: "active",
    });
  });

  it("is a full overwrite — a second write REPLACES stale fields, never merges", async () => {
    await db.runTransaction(async (tx) => {
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: ORG_A,
        email: "bob@example.com",
        role: "owner",
        name: "Bob",
        status: "active",
      });
    });
    await db.runTransaction(async (tx) => {
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: ORG_A,
        email: "bob@example.com",
        role: "editor",
        name: "Bob Renamed",
        status: "active",
      });
    });

    const row = await getAdminOrganizationMember(ORG_A, "bob@example.com");
    expect(row?.role).toBe("editor");
    expect(row?.name).toBe("Bob Renamed");
  });
});

describe("deleteAdminOrganizationMemberInTransaction", () => {
  it("removes exactly the targeted row", async () => {
    await db.runTransaction(async (tx) => {
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: ORG_A,
        email: "carol@example.com",
        role: "viewer",
        name: "Carol",
        status: "active",
      });
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: ORG_A,
        email: "dave@example.com",
        role: "viewer",
        name: "Dave",
        status: "active",
      });
    });

    await db.runTransaction(async (tx) => {
      deleteAdminOrganizationMemberInTransaction(
        tx,
        ORG_A,
        "carol@example.com",
      );
    });

    expect(
      await getAdminOrganizationMember(ORG_A, "carol@example.com"),
    ).toBeNull();
    expect(
      await getAdminOrganizationMember(ORG_A, "dave@example.com"),
    ).not.toBeNull();
  });
});

describe("listAdminOrganizationMembers — cross-org isolation (spec §7 AC-1)", () => {
  it("only returns rows for the requested organizationId", async () => {
    await db.runTransaction(async (tx) => {
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: ORG_A,
        email: "aardvark@example.com",
        role: "owner",
        name: "A",
        status: "active",
      });
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: ORG_B,
        email: "aardvark2@example.com",
        role: "owner",
        name: "A2",
        status: "active",
      });
    });

    const members = await listAdminOrganizationMembers(ORG_A);
    expect(members).toHaveLength(1);
    expect(members[0].email).toBe("aardvark@example.com");
  });
});

describe("owner counting", () => {
  it("countAdminOrganizationOwners counts only role === 'owner' rows for this org", async () => {
    await db.runTransaction(async (tx) => {
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: ORG_A,
        email: "owner1@example.com",
        role: "owner",
        name: "Owner1",
        status: "active",
      });
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: ORG_A,
        email: "owner2@example.com",
        role: "owner",
        name: "Owner2",
        status: "active",
      });
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: ORG_A,
        email: "admin1@example.com",
        role: "admin",
        name: "Admin1",
        status: "active",
      });
      // Different org — must not be counted.
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: ORG_B,
        email: "owner1@example.com",
        role: "owner",
        name: "Owner1",
        status: "active",
      });
    });

    expect(await countAdminOrganizationOwners(ORG_A)).toBe(2);
    expect(await countAdminOrganizationOwners(ORG_B)).toBe(1);
  });

  it("countAdminOrganizationOwnersInTransaction agrees with the non-transactional count", async () => {
    await db.runTransaction(async (tx) => {
      putAdminOrganizationMemberInTransaction(tx, {
        organizationId: ORG_A,
        email: "sole-owner@example.com",
        role: "owner",
        name: "Sole",
        status: "active",
      });
    });

    const count = await db.runTransaction((tx) =>
      countAdminOrganizationOwnersInTransaction(tx, ORG_A),
    );
    expect(count).toBe(1);
  });
});
