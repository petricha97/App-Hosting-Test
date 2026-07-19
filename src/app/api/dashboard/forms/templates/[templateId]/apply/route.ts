import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import decodeUser from "@/lib/auth-utils";
import {
  applyAdminTemplateToForms,
  getAdminLinkedFormsForTemplate,
  MAX_TEMPLATE_APPLY_FORMS,
  TemplateApplyIneligibleFormError,
  TemplateApplyLimitError,
} from "@/lib/db/adminForm";
import { getAdminFormTemplateForOrganization } from "@/lib/db/adminFormTemplate";
import { getAdminUserByEmail } from "@/lib/db/adminUser";

const COOKIE_NAME = "session";

const ApplyTemplateRequestSchema = z.object({
  mode: z.enum(["all", "selected"]),
  formIds: z.array(z.string().trim().min(1)).default([]),
});

function templateApplyLimitResponse() {
  return NextResponse.json(
    {
      error: {
        code: "TEMPLATE_APPLY_LIMIT_EXCEEDED",
        message: `A template can be applied to at most ${MAX_TEMPLATE_APPLY_FORMS} linked forms at once`,
        maxForms: MAX_TEMPLATE_APPLY_FORMS,
      },
    },
    { status: 422 },
  );
}

function templateApplyIneligibleFormResponse() {
  return NextResponse.json(
    {
      error: {
        code: "TEMPLATE_APPLY_INELIGIBLE_FORM",
        message: "One or more selected forms cannot receive this template",
      },
    },
    { status: 422 },
  );
}

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

  if (parsed.data.formIds.length > MAX_TEMPLATE_APPLY_FORMS) {
    return templateApplyLimitResponse();
  }

  let formsToUpdate;

  if (parsed.data.mode === "all") {
    const linkedForms = await getAdminLinkedFormsForTemplate({
      templateId,
      organizationId: userDoc.organizationId,
      // Read one extra row so overflow is rejected instead of truncated. The
      // mutation stays within one genuinely atomic Firestore batch.
      limit: MAX_TEMPLATE_APPLY_FORMS + 1,
    });

    if (linkedForms.length > MAX_TEMPLATE_APPLY_FORMS) {
      return templateApplyLimitResponse();
    }

    formsToUpdate = linkedForms.filter((form) => !form.templateLink?.detached);
  } else {
    // The DAL reloads and validates every requested form. Resolve selected mode
    // by its bounded ID list so an unrelated discovery limit cannot omit one.
    formsToUpdate = parsed.data.formIds.map((id) => ({ id }));
  }

  if (formsToUpdate.length > MAX_TEMPLATE_APPLY_FORMS) {
    return templateApplyLimitResponse();
  }

  let updatedIds: string[];

  try {
    updatedIds = await applyAdminTemplateToForms({
      template,
      forms: formsToUpdate,
    });
  } catch (error) {
    if (error instanceof TemplateApplyLimitError) {
      return templateApplyLimitResponse();
    }

    if (error instanceof TemplateApplyIneligibleFormError) {
      return templateApplyIneligibleFormResponse();
    }

    throw error;
  }

  return NextResponse.json({
    updatedCount: updatedIds.length,
    updatedIds,
  });
}
