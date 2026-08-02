import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { EventVariablesPage } from "@/features/variables/components/event-variables-page";
import {
  buildEventBuiltInVariables,
  buildOrganizationBuiltInVariables,
  serializeVariable,
} from "@/features/variables/utils";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import {
  getAdminVariablesForEvent,
  getAdminVariablesForOrganization,
} from "@/lib/db/adminVariable";

export const metadata: Metadata = {
  title: "Variables | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventVariablesRoutePage({ params }: PageProps) {
  const { eventId } = await params;
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(eventId, scope.organizationId);

  if (!event) {
    notFound();
  }

  const [organizationVariables, eventVariables] = await Promise.all([
    getAdminVariablesForOrganization(scope.organizationId),
    getAdminVariablesForEvent({ organizationId: scope.organizationId, eventId }),
  ]);

  return (
    <EventVariablesPage
      canManage={scope.userDoc.permissions.includes("write:events")}
      eventId={eventId}
      organizationBuiltIns={buildOrganizationBuiltInVariables(scope.organization ?? null)}
      eventBuiltIns={buildEventBuiltInVariables(event)}
      organizationVariables={organizationVariables.map(serializeVariable)}
      initialEventVariables={eventVariables.map(serializeVariable)}
    />
  );
}
