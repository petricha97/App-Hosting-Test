import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { resolveVariablesEventRouteScope } from "@/features/variables/server/route-scope";
import { variablePayloadSchema } from "@/features/variables/schema";
import { RESERVED_VARIABLE_KEYS, serializeVariable } from "@/features/variables/utils";
import {
  createAdminVariable,
  isAdminVariableKeyTaken,
} from "@/lib/db/adminVariable";

interface RouteContext {
  params: Promise<{ eventId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const scope = await resolveVariablesEventRouteScope(eventId);
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
      scope: "event",
      eventId,
      key: parsed.data.key,
    })
  ) {
    return NextResponse.json(
      { error: "This event variable key already exists." },
      { status: 409 },
    );
  }

  const now = FieldValue.serverTimestamp();
  const variableId = await createAdminVariable({
    organizationId: scope.organizationId,
    scope: "event",
    eventId,
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
      scope: "event",
      eventId,
      key: parsed.data.key,
      value: parsed.data.value,
      description: parsed.data.description,
      createdAt: now,
      updatedAt: now,
    }),
  });
}
