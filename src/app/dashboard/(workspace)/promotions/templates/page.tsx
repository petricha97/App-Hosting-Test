// Dashboard page: /dashboard/promotions/templates
// Server Component — fetches org-scoped promotion templates via the Admin SDK,
// serializes them (Timestamps → ISO strings), and passes them to the
// PromotionTemplatesBrowser Client Component for interactive display.
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminPromotionTemplatesForOrganization } from "@/lib/db/adminPromotionTemplate";
import { serializePromotionTemplate } from "@/features/promotion-templates/utils";
import { PromotionTemplatesBrowser } from "@/features/promotion-templates/components/promotion-templates-browser";

export default async function DashboardPromotionTemplatesPage() {
  const scope = await getDashboardScope();
  const templates = await getAdminPromotionTemplatesForOrganization(
    scope.organizationId,
  );
  const serialized = templates.map(serializePromotionTemplate);

  return (
    <PromotionTemplatesBrowser
      initialTemplates={serialized}
      workspaceName={scope.organization?.name ?? null}
    />
  );
}
