// Registration Paths screen (M3-T1). Server Component: verifies org
// ownership (404 on cross-org), fetches paths + registration types (audience
// names) via the admin DAL, and renders the client workspace. Mutations go
// through the API routes + router.refresh().
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { RegistrationPathsWorkspace } from "@/features/registration-paths/components/registration-paths-workspace";
import {
  serializeRegistrationPath,
  type SerializedRegistrationPath,
} from "@/features/registration-paths/types";
import {
  serializeRegistrationType,
  type SerializedRegistrationType,
} from "@/features/registration/types";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminEventPageKeysForEvent } from "@/lib/db/adminEventPage";
import { getAdminRegistrationPathsForEvent } from "@/lib/db/adminRegistrationPath";
import { getAdminRegistrationTypesForEvent } from "@/lib/db/adminRegistrationType";

export const metadata: Metadata = {
  title: "Registration Paths | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventRegistrationPathsPage({ params }: PageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(
    eventId,
    scope.organizationId,
  );

  if (!event) {
    notFound();
  }

  let paths: SerializedRegistrationPath[] = [];
  let registrationTypes: SerializedRegistrationType[] = [];
  let customPageKeys: string[] = [];
  let loadError = false;
  try {
    const [pathDocs, registrationTypeDocs, pageKeys] = await Promise.all([
      getAdminRegistrationPathsForEvent({
        eventId,
        organizationId: scope.organizationId,
      }),
      getAdminRegistrationTypesForEvent({
        eventId,
        organizationId: scope.organizationId,
      }),
      getAdminEventPageKeysForEvent({
        eventId,
        organizationId: scope.organizationId,
      }),
    ]);
    paths = pathDocs.map(serializeRegistrationPath);
    registrationTypes = registrationTypeDocs.map(serializeRegistrationType);
    // M4-T2: the "Page" column only cares about PATH pages, not "default".
    customPageKeys = pageKeys.filter((key) => key !== "default");
  } catch {
    // Shell stays interactive; the workspace shows a retryable error panel.
    loadError = true;
  }

  return (
    <RegistrationPathsWorkspace
      eventId={eventId}
      paths={paths}
      registrationTypes={registrationTypes}
      customPageKeys={customPageKeys}
      loadError={loadError}
    />
  );
}
