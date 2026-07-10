import "server-only";

import { adminDb } from "@/app/lib/firestore";
import { createAdminCollectionApi } from "@/lib/db/adminBase";
import type { OrganizationDoc, WithId } from "@/types/collection";

const ORGANIZATION_COLLECTION = "Organization";

const organizationAdminApi = createAdminCollectionApi<OrganizationDoc>(
  ORGANIZATION_COLLECTION,
);

export const {
  getById: getAdminOrganizationById,
  set: setAdminOrganization,
  update: updateAdminOrganization,
} = organizationAdminApi;

function organizationCol() {
  return adminDb.collection(ORGANIZATION_COLLECTION);
}

// Invite-code entitlement lookup for the server-side join flows (SEC M2
// Finding 3: the Organization collection is no longer client-readable at
// large, so invite codes are validated HERE with the Admin SDK and only
// sanitized fields ever leave the API route). Expects the code already
// normalized (normalizeInviteCode). Equality-only query — merge-servable,
// no composite index needed.
export async function getAdminOrganizationByInviteCode(
  normalizedCode: string,
): Promise<WithId<OrganizationDoc> | null> {
  if (!normalizedCode) return null;

  const snap = await organizationCol()
    .where("inviteCode", "==", normalizedCode)
    .where("inviteCodeEnabled", "==", true)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...(doc.data() as OrganizationDoc) };
}

// Domain auto-join lookup (server mirror of the client getOrganizationByDomain,
// used by the join route to validate the entitlement against the CALLER'S
// token email domain — never a client-supplied domain).
export async function getAdminOrganizationByDomain(
  domain: string,
): Promise<WithId<OrganizationDoc> | null> {
  if (!domain) return null;

  const snap = await organizationCol()
    .where("domain", "==", domain)
    .where("allowDomainAutoJoin", "==", true)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...(doc.data() as OrganizationDoc) };
}
