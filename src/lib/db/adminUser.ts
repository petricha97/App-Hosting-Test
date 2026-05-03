import "server-only";

import { createAdminCollectionApi } from "@/lib/db/adminBase";
import type { UserDoc } from "@/types/collection";

const userAdminApi = createAdminCollectionApi<UserDoc>("User");

export const {
  getById: getAdminUserByEmail,
  set: setAdminUser,
  update: updateAdminUser,
} = userAdminApi;
