import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { buildAssetFolderPayload, buildAssetFolderOptions } from "@/features/assets/server/asset-helpers";
import { AssetsLibraryPage } from "@/features/assets/components/assets-library-page";

export default async function DashboardAssetsPage() {
  const scope = await getDashboardScope();

  return (
    <AssetsLibraryPage
      canManage={scope.userDoc.permissions.includes("write:organization")}
      initialFolderPayload={await buildAssetFolderPayload({
        organizationId: scope.organizationId,
        folderId: null,
      })}
      initialFolderOptions={await buildAssetFolderOptions(scope.organizationId)}
    />
  );
}
