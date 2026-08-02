import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { variablePayloadSchema } from "@/features/variables/schema";
import { serializeVariable, RESERVED_VARIABLE_KEYS } from "@/features/variables/utils";
import {
  createAdminVariable,
  isAdminVariableKeyTaken,
} from "@/lib/db/adminVariable";
import { resolveVariablesOrganizationRouteScope } from "@/features/variables/server/route-scope";

export async function POST(request: Request) {
  const scope = await resolveVariablesOrganizationRouteScope();
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
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
    })
  ) {
    return NextResponse.json(
      { error: "This organization variable key already exists." },
      { status: 409 },
    );
  }

  const now = FieldValue.serverTimestamp();
  const variableId = await createAdminVariable({
    organizationId: scope.organizationId,
    scope: "organization",
    key: parsed.data.key,
    value: parsed.data.value,
    description: parsed.data.description,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({
    variable: serializeVariable({
      id: variableId,
      organizationId: scope.organizationId,
      scope: "organization",
      key: parsed.data.key,
      value: parsed.data.value,
      description: parsed.data.description,
      createdAt: now,
      updatedAt: now,
    }),
  });
}
