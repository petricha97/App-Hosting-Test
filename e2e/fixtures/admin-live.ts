import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type Firestore,
} from "firebase-admin/firestore";
import { nanoid } from "nanoid";

const OWNER_PERMISSIONS = [
  "view:events",
  "write:events",
  "view:form",
  "write:form",
  "view:invoice",
  "write:invoice",
  "view:promotion",
  "write:promotion",
  "view:organization",
  "write:organization",
  "view:user",
  "write:user",
] as const;

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
]);

export interface OrganizationInventoryItem {
  id: string;
  name: string;
  role: string;
  status: string | null;
}

// M5/M6 (Phase 3) — read-only Attendee/RegistrationDraft/EmailMessage
// lookups so the harness can (a) mint the real deterministic QR token for a
// known attendee (mirrors src/lib/qr/qr-token.ts, see e2e/fixtures/qr-token.ts)
// and (b) verify abandoned-draft/email-send-log state directly when a UI
// affordance is timing-gated (M5-T3's 24h Abandoned-tab threshold). These
// are READ-ONLY verification helpers, never used to mutate app data outside
// what the real UI/API already created.
export interface LiveAttendeeRecord {
  id: string;
  submissionId: string;
  email: string;
  status: string;
  checkInState: string;
  qrTokenHash: string;
  registrationTypeLabel: string;
  ticketLabel: string;
}

export async function getAdminAttendeesForEmail(input: {
  organizationId: string;
  eventId: string;
  email: string;
}): Promise<LiveAttendeeRecord[]> {
  const db = liveAdminDb();
  const snap = await db
    .collection("Attendee")
    .where("organizationId", "==", input.organizationId)
    .where("eventId", "==", input.eventId)
    .where("email", "==", input.email)
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      submissionId: String(data.submissionId ?? ""),
      email: String(data.email ?? ""),
      status: String(data.status ?? ""),
      checkInState: String(data.checkInState ?? ""),
      qrTokenHash: String(data.qrTokenHash ?? ""),
      registrationTypeLabel: String(data.registrationTypeLabel ?? ""),
      ticketLabel: String(data.ticketLabel ?? ""),
    };
  });
}

export interface LiveDraftRecord {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  lastStepReached: string;
  updatedAtIso: string;
  ageHours: number;
}

export async function getAdminAbandonedDraftsForEmail(input: {
  organizationId: string;
  eventId: string;
  email: string;
}): Promise<LiveDraftRecord[]> {
  const db = liveAdminDb();
  const snap = await db
    .collection("RegistrationDraft")
    .where("organizationId", "==", input.organizationId)
    .where("eventId", "==", input.eventId)
    .where("email", "==", input.email)
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const updatedAt = data.updatedAt as
      | { toDate?: () => Date }
      | string
      | undefined;
    const updatedAtDate =
      typeof updatedAt === "object" && updatedAt?.toDate
        ? updatedAt.toDate()
        : new Date(String(updatedAt));
    const ageHours =
      (Date.now() - updatedAtDate.getTime()) / (1000 * 60 * 60);
    return {
      id: doc.id,
      firstName: String(data.firstName ?? ""),
      lastName: String(data.lastName ?? ""),
      email: String(data.email ?? ""),
      lastStepReached: String(data.lastStepReached ?? ""),
      updatedAtIso: updatedAtDate.toISOString(),
      ageHours,
    };
  });
}

export interface LiveEmailMessageRecord {
  id: string;
  kind: string;
  status: string;
  recipientEmail: string;
  dedupeKey: string;
  subject: string;
}

export async function getAdminEmailMessagesForEvent(input: {
  organizationId: string;
  eventId: string;
}): Promise<LiveEmailMessageRecord[]> {
  const db = liveAdminDb();
  const snap = await db
    .collection("EmailMessage")
    .where("organizationId", "==", input.organizationId)
    .where("eventId", "==", input.eventId)
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const recipient = data.recipient as { email?: string } | undefined;
    return {
      id: doc.id,
      kind: String(data.kind ?? ""),
      status: String(data.status ?? ""),
      recipientEmail: String(recipient?.email ?? ""),
      dedupeKey: String(data.dedupeKey ?? ""),
      subject: String(data.subject ?? ""),
    };
  });
}

// Phase 4 (M7/M8) — broader read-only lookups spanning the WHOLE event
// (not one registrant's email) so the QA specs can independently compute the
// "ground truth" numbers (registrations by ticket type, paid/outstanding/
// comped totals, discount usage, abandoned-draft count past the 24h
// threshold) to cross-check against what the Reports/Overview/Dashboard UI
// renders. Still strictly READ-ONLY.
export interface LiveAttendeeSummary {
  id: string;
  email: string;
  status: string;
  ticketTypeId: string | null;
  ticketLabel: string;
  registrationTypeLabel: string;
  checkInState: string;
}

export async function getAdminAllAttendeesForEvent(input: {
  organizationId: string;
  eventId: string;
}): Promise<LiveAttendeeSummary[]> {
  const db = liveAdminDb();
  const snap = await db
    .collection("Attendee")
    .where("organizationId", "==", input.organizationId)
    .where("eventId", "==", input.eventId)
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      email: String(data.email ?? ""),
      status: String(data.status ?? ""),
      ticketTypeId: (data.ticketTypeId as string | null) ?? null,
      ticketLabel: String(data.ticketLabel ?? ""),
      registrationTypeLabel: String(data.registrationTypeLabel ?? ""),
      checkInState: String(data.checkInState ?? ""),
    };
  });
}

export interface LiveOrderSummary {
  id: string;
  paymentStatus: string;
  currency: string;
  totalMinor: number;
  subtotalMinor: number;
  promoCode: string | null;
}

export async function getAdminAllOrdersForEvent(input: {
  organizationId: string;
  eventId: string;
}): Promise<LiveOrderSummary[]> {
  const db = liveAdminDb();
  const snap = await db
    .collection("Order")
    .where("organizationId", "==", input.organizationId)
    .where("eventId", "==", input.eventId)
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const amounts = (data.amounts as Record<string, unknown>) ?? {};
    const snapshot = (data.snapshot as Record<string, unknown>) ?? {};
    return {
      id: doc.id,
      paymentStatus: String(data.paymentStatus ?? ""),
      currency: String(data.currency ?? ""),
      totalMinor: Number(amounts.totalMinor ?? 0),
      subtotalMinor: Number(amounts.subtotalMinor ?? 0),
      promoCode: (snapshot.promoCode as string | null) ?? null,
    };
  });
}

export interface LivePromotionSummary {
  id: string;
  code: string;
  usedCount: number;
}

export async function getAdminEventPromotionsSummary(input: {
  organizationId: string;
  eventId: string;
}): Promise<LivePromotionSummary[]> {
  const db = liveAdminDb();
  const snap = await db
    .collection("Event")
    .doc(input.eventId)
    .collection("EventPromotion")
    .where("organizationId", "==", input.organizationId)
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      // EventPromotionDoc's real field is `promoCode` (+ normalized
      // `promoCodeUpper`) — there is no plain `code` field (collection.ts).
      code: String(data.promoCodeUpper ?? data.promoCode ?? ""),
      usedCount: Number(data.usedCount ?? 0),
    };
  });
}

export async function countAdminAbandonedDraftsPastThreshold(input: {
  organizationId: string;
  eventId: string;
  thresholdMs?: number;
}): Promise<number> {
  const db = liveAdminDb();
  const snap = await db
    .collection("RegistrationDraft")
    .where("organizationId", "==", input.organizationId)
    .where("eventId", "==", input.eventId)
    .get();

  const thresholdHours = (input.thresholdMs ?? 24 * 60 * 60 * 1000) / 3_600_000;
  let count = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const updatedAt = data.updatedAt as { toDate?: () => Date } | undefined;
    const updatedAtDate = updatedAt?.toDate ? updatedAt.toDate() : null;
    if (!updatedAtDate) continue;
    const ageHours = (Date.now() - updatedAtDate.getTime()) / 3_600_000;
    if (ageHours > thresholdHours) count += 1;
  }
  return count;
}

// Reads the real, opaque invitation-accept token straight from Firestore as
// a fallback verification path — the harness primarily captures the accept
// URL directly from the Invite dialog's own "sent" view (no email delivery
// needed either way, matching M8-T1's D8 copy-the-link UX), but this helper
// lets a test independently confirm the InvitationDoc's real persisted state
// (role, status) without trusting only the client-rendered URL.
export async function getAdminInvitationForEmail(input: {
  organizationId: string;
  email: string;
}): Promise<{ role: string; status: string; token: string } | null> {
  const db = liveAdminDb();
  const snap = await db
    .collection("Invitation")
    .where("organizationId", "==", input.organizationId)
    .where("email", "==", input.email.trim().toLowerCase())
    .limit(1)
    .get();
  if (snap.empty) return null;
  const data = snap.docs[0].data() as Record<string, unknown>;
  return {
    role: String(data.role ?? ""),
    status: String(data.status ?? ""),
    token: String(data.token ?? ""),
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the live E2E setup`);
  }
  return value;
}

function liveAdminDb(): Firestore {
  const appName = "playwright-live-e2e";
  const existing = getApps().find((app) => app.name === appName);
  const app =
    existing ??
    initializeApp(
      {
        credential: cert({
          projectId: requireEnvironment("FIREBASE_PROJECT_ID"),
          clientEmail: requireEnvironment("FIREBASE_CLIENT_EMAIL"),
          privateKey: requireEnvironment("FIREBASE_PRIVATE_KEY").replace(
            /\\n/g,
            "\n",
          ),
        }),
        storageBucket:
          process.env.FIREBASE_STORAGE_BUCKET ??
          process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      },
      appName,
    );
  return getFirestore(getApp(app.name));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function inviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 8 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

export async function inventoryOrganizationsForUser(
  email: string,
): Promise<OrganizationInventoryItem[]> {
  const db = liveAdminDb();
  const normalizedEmail = email.trim().toLowerCase();
  const userSnap = await db.collection("User").doc(normalizedEmail).get();
  if (!userSnap.exists) {
    throw new Error(
      "Login succeeded, but the corresponding Firestore User document does not exist",
    );
  }

  const user = userSnap.data() as {
    organizations?: Array<{ organizationId: string; role?: string }>;
  };
  const memberships = user.organizations ?? [];
  const refs = memberships.map((membership) =>
    db.collection("Organization").doc(membership.organizationId),
  );
  const organizations = refs.length > 0 ? await db.getAll(...refs) : [];

  return memberships.map((membership, index) => {
    const data = organizations[index]?.data() as
      | { name?: string; status?: string }
      | undefined;
    return {
      id: membership.organizationId,
      name: data?.name ?? "(missing organization document)",
      role: membership.role ?? "unknown",
      status: data?.status ?? null,
    };
  });
}

/**
 * Creates one additional organization for an existing user using the same
 * atomic shape as createAdminOrganizationWithOwner. There is no shipped UI
 * for an existing account to create a second organization, so the live E2E
 * harness performs this one setup mutation directly through Firebase Admin.
 */
export async function createDedicatedOrganization(input: {
  email: string;
  name: string;
}): Promise<string> {
  const db = liveAdminDb();
  const normalizedEmail = input.email.trim().toLowerCase();
  const domain = normalizedEmail.split("@")[1] ?? "";
  const isPersonal = PERSONAL_EMAIL_DOMAINS.has(domain);
  const orgRef = db.collection("Organization").doc();
  const userRef = db.collection("User").doc(normalizedEmail);
  const membership = {
    organizationId: orgRef.id,
    role: "owner",
    joinedAt: Timestamp.now(),
    joinMethod: "created",
  };

  await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) {
      throw new Error(
        "Refusing to create the E2E organization because the real account User document is missing",
      );
    }
    const user = userSnap.data() as {
      name?: string;
      organizations?: Array<{ organizationId: string }>;
    };
    if (
      (user.organizations ?? []).some(
        (item) => item.organizationId === orgRef.id,
      )
    ) {
      throw new Error("Generated organization id unexpectedly already exists");
    }

    transaction.create(orgRef, {
      name: input.name,
      description:
        "Dedicated persistent Playwright E2E organization for the 2026-07-26 four-phase regression. Do not delete; later phases depend on it.",
      slug: slugify(input.name),
      type: isPersonal ? "workspace" : "organization",
      status: "pending",
      domainVerified: false,
      inviteCode: inviteCode(),
      inviteCodeEnabled: true,
      inviteLinkToken: nanoid(32),
      inviteLinkEnabled: true,
      allowDomainAutoJoin: !isPersonal,
      ownerId: normalizedEmail,
      memberCount: 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(!isPersonal && domain ? { domain } : {}),
    });
    transaction.update(userRef, {
      organizationId: orgRef.id,
      organizationRole: "owner",
      organizations: FieldValue.arrayUnion(membership),
      permissions: [...OWNER_PERMISSIONS],
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      db
        .collection("OrganizationMember")
        .doc(`${orgRef.id}_${normalizedEmail}`),
      {
        organizationId: orgRef.id,
        email: normalizedEmail,
        role: "owner",
        name: user.name ?? "",
        status: "active",
      },
    );
  });

  return orgRef.id;
}
