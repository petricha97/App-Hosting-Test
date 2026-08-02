import "server-only";

import { createAdminCollectionApi } from "@/lib/db/adminBase";
import type { VariableDoc, WithId } from "@/types/collection";
import { sortVariables } from "@/features/variables/utils";

const VARIABLE_COLLECTION = "Variable";

const variableAdminApi = createAdminCollectionApi<VariableDoc>(VARIABLE_COLLECTION);

export const {
  create: createAdminVariable,
  getById: getAdminVariableById,
  update: updateAdminVariable,
  remove: deleteAdminVariable,
  findWhere: findAdminVariablesByField,
} = variableAdminApi;

export async function getAdminVariablesForOrganization(
  organizationId: string,
): Promise<WithId<VariableDoc>[]> {
  const variables = await findAdminVariablesByField("organizationId", organizationId);
  return sortVariables(
    variables.filter((variable) => variable.scope === "organization"),
  );
}

export async function getAdminVariablesForEvent(input: {
  organizationId: string;
  eventId: string;
}): Promise<WithId<VariableDoc>[]> {
  const variables = await findAdminVariablesByField(
    "organizationId",
    input.organizationId,
  );

  return sortVariables(
    variables.filter(
      (variable) =>
        variable.scope === "event" && variable.eventId === input.eventId,
    ),
  );
}

export async function getAdminVariableForOrganizationScope(input: {
  organizationId: string;
  variableId: string;
}) {
  const variable = await getAdminVariableById(input.variableId);
  if (
    !variable ||
    variable.organizationId !== input.organizationId ||
    variable.scope !== "organization"
  ) {
    return null;
  }

  return variable;
}

export async function getAdminVariableForEventScope(input: {
  organizationId: string;
  eventId: string;
  variableId: string;
}) {
  const variable = await getAdminVariableById(input.variableId);
  if (
    !variable ||
    variable.organizationId !== input.organizationId ||
    variable.scope !== "event" ||
    variable.eventId !== input.eventId
  ) {
    return null;
  }

  return variable;
}

export async function isAdminVariableKeyTaken(input: {
  organizationId: string;
  scope: "organization" | "event";
  key: string;
  eventId?: string;
  excludeVariableId?: string;
}) {
  const variables = await findAdminVariablesByField("organizationId", input.organizationId);

  return variables.some((variable) => {
    if (input.excludeVariableId && variable.id === input.excludeVariableId) {
      return false;
    }

    if (variable.scope !== input.scope || variable.key !== input.key) {
      return false;
    }

    if (input.scope === "event") {
      return variable.eventId === input.eventId;
    }

    return true;
  });
}
