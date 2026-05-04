import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import {
  applyAdminTemplateToForms,
  getAdminLinkedFormsForTemplate,
} from "@/lib/db/adminForm";
import { getAdminFormTemplateForOrganization } from "@/lib/db/adminFormTemplate";
import { getAdminUserByEmail } from "@/lib/db/adminUser";

const COOKIE_NAME = "session";

const ApplyTemplateRequestSchema = z.object({
  mode: z.enum(["all", "selected"]),
  formIds: z.array(z.string().trim().min(1)).default([]),
});

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { templateId } = await context.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json({ error: "Missing session" }, { status: 401 });
  }

  const decodedUser = await decodeUser(token);

  if ("error" in decodedUser) {
    return NextResponse.json({ error: decodedUser.error }, { status: 401 });
  }

  const userDoc = await getAdminUserByEmail(decodedUser.email.toLowerCase());

  if (!userDoc?.organizationId) {
    return NextResponse.json({ error: "Missing organization scope" }, { status: 403 });
  }

  if (!userDoc.permissions.includes("write:form")) {
    return NextResponse.json({ error: "Missing write:form permission" }, { status: 403 });
  }

  const template = await getAdminFormTemplateForOrganization(
    templateId,
    userDoc.organizationId,
  );

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = ApplyTemplateRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const linkedForms = await getAdminLinkedFormsForTemplate({
    templateId,
    organizationId: userDoc.organizationId,
  });

  const eligibleForms = linkedForms.filter((form) => !form.templateLink?.detached);
  const formsToUpdate =
    parsed.data.mode === "all"
      ? eligibleForms
      : eligibleForms.filter((form) => parsed.data.formIds.includes(form.id));

  const updatedIds = await applyAdminTemplateToForms({
    template,
    forms: formsToUpdate,
  });

  return NextResponse.json({
    updatedCount: updatedIds.length,
    updatedIds,
  });
}
