// Dashboard page: /dashboard/promotions
// Stub page for active promotions (discount codes applied to events).
// Links to the promotion templates page where templates are managed.
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardPageHeader } from "@/features/dashboard/components/page-header";

export default function DashboardPromotionsPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Promotions"
        title="Active Promotions"
        description="Discount codes and promotions applied to events in this workspace."
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard/promotions/templates">Manage templates</Link>
          </Button>
        }
      />

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-2xl text-slate-950">
            No active promotions
          </CardTitle>
          <CardDescription>
            There are no active promotion templates now. Start by creating
            promotion templates.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-0">
          <Button asChild className="rounded-full">
            <Link href="/dashboard/promotions/templates">Go to templates</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
