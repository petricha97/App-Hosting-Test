import { Card, CardContent } from "@/components/ui/card";
import { EventPromotionManager } from "@/features/event-promotions/components/event-promotion-manager";
import type { SerializedEventPromotion } from "@/features/event-promotions/types";
import type { SerializedPromotionTemplate } from "@/features/promotion-templates/types";
import type { EventOverviewData } from "./event-overview-types";
import { EventIdentity } from "./event-identity";
import { EventOverviewStats } from "./event-overview-stats";
import { EventQuickActions } from "./event-quick-actions";
import { PublicReadiness } from "./public-readiness";

export function EventOverview({ eventId, data, promotions, availableTemplates }: { eventId: string; data: EventOverviewData; promotions: SerializedEventPromotion[]; availableTemplates: SerializedPromotionTemplate[] }) {
  return (
    <div className="space-y-6">
      <EventOverviewStats eventId={eventId} data={data} />
      <div className="grid min-w-0 gap-6 xl:grid-cols-[2fr_1fr]">
        <Card className="min-w-0 rounded-2xl border-border bg-card py-0">
          <CardContent className="px-5 py-5">
            <EventQuickActions eventId={eventId} />
            <EventIdentity data={data} />
          </CardContent>
        </Card>
        <PublicReadiness readiness={data.readiness} />
      </div>
      <section id="promotions" className="scroll-mt-24">
        <EventPromotionManager eventId={eventId} promotions={promotions} availableTemplates={availableTemplates} />
      </section>
    </div>
  );
}
