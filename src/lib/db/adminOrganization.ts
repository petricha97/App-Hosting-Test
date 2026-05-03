import "server-only";

import { createAdminCollectionApi } from "@/lib/db/adminBase";
import type { OrganizationDoc } from "@/types/collection";

const organizationAdminApi =
  createAdminCollectionApi<OrganizationDoc>("Organization");

export const {
  getById: getAdminOrganizationById,
  set: setAdminOrganization,
  update: updateAdminOrganization,
} = organizationAdminApi;
