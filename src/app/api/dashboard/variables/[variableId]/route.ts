import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { resolveVariablesOrganizationRouteScope } from "@/features/variables/server/route-scope";
import { variablePayloadSchema } from "@/features/variables/schema";
import { RESERVED_VARIABLE_KEYS, serializeVariable } from "@/features/variables/utils";
import {
  deleteAdminVariable,
  getAdminVariableForOrganizationScope,
  isAdminVariableKeyTaken,
  updateAdminVariable,
} from "@/lib/db/adminVariable";

interface RouteContext {
  params: Promise<{ variableId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { variableId } = await context.params;
  const scope = await resolveVariablesOrganizationRouteScope();
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const variable = await getAdminVariableForOrganizationScope({
    organizationId: scope.organizationId,
    variableId,
  });
  if (!variable) {
    return NextResponse.json({ error: "Variable not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = variablePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (RESERVED_VARIABLE_KEYS.has(parsed.data.key)) {
    return NextResponse.json(
      { error: "This key is reserved for a built-in variable." },
      { status: 409 },
    );
  }

  if (
    await isAdminVariableKeyTaken({
      organizationId: scope.organizationId,
      scope: "organization",
      key: parsed.data.key,
      excludeVariableId: variableId,
    })
  ) {
    return NextResponse.json(
      { error: "This organization variable key already exists." },
      { status: 409 },
    );
  }

  const updatedAt = FieldValue.serverTimestamp();
  await updateAdminVariable(variableId, {
    key: parsed.data.key,
    value: parsed.data.value,
    description: parsed.data.description,
    updatedAt,
  });

  return NextResponse.json({
    variable: serializeVariable({
      ...variable,
      key: parsed.data.key,
      value: parsed.data.value,
      description: parsed.data.description,
      updatedAt,
    }),
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { variableId } = await context.params;
  const scope = await resolveVariablesOrganizationRouteScope();
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const variable = await getAdminVariableForOrganizationScope({
    organizationId: scope.organizationId,
    variableId,
  });
  if (!variable) {
    return NextResponse.json({ error: "Variable not found" }, { status: 404 });
  }

  await deleteAdminVariable(variableId);
  return NextResponse.json({ success: true });
}
