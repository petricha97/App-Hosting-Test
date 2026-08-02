// Dashboard page: /dashboard/promotions
// Shows all EventPromotion docs currently attached to events in this org.
// Each card displays the promotion name, which event it belongs to, the discount,
// redemption mode (promo code badge or auto-apply badge), and condition badges.
// Uses a Firestore collectionGroup query to fetch across all events in one pass.
import Link from "next/link";
import { Tag, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { getAdminAllEventPromotionsForOrg } from "@/lib/db/adminEventPromotion";
import { getAdminEventsForOrganization } from "@/lib/db/adminEvent";
import { serializeEventPromotion } from "@/features/event-promotions/utils";
import { formatConditionRule } from "@/features/event-promotions/utils";
import type { WithId, EventPromotionDoc } from "@/types/collection";

export default async function DashboardPromotionsPage() {
  const scope = await getDashboardScope();

  // Fetch all events first so we have both event IDs (for the subcollection queries)
  // and event names (for display). Then fetch all promotions in parallel per event.
  const events = await getAdminEventsForOrganization(scope.organizationId);

  // Build a quick lookup map: eventId → event name for display.
  const eventNameMap = new Map(events.map((e) => [e.id, e.name]));

  // Pass the event IDs so the DB function can query each subcollection directly —
  // no collection-group index required.
  const rawPromotions = await getAdminAllEventPromotionsForOrg(
    scope.organizationId,
    events.map((e) => e.id),
  );

  // Serialize each promotion doc so Timestamps become strings safe for the client,
  // then sort newest-first so the list is stable across renders.
  const promotions = rawPromotions
    .map((p) => ({
      // serializeEventPromotion expects WithId<EventPromotionDoc>; cast the base shape.
      ...serializeEventPromotion(p as WithId<EventPromotionDoc>),
      eventId: p.eventId,
      eventName: eventNameMap.get(p.eventId) ?? "Unknown event",
    }))
    .sort((a, b) => {
      // Sort descending by updatedAt — nulls go to the end.
      if (!a.updatedAt && !b.updatedAt) return 0;
      if (!a.updatedAt) return 1;
      if (!b.updatedAt) return -1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button asChild variant="outline">
          <Link href="/dashboard/promotions/templates">Manage templates</Link>
        </Button>
      </div>

      {promotions.length === 0 ? (
        // Empty state — shown when no templates have been attached to any event yet.
        <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
          <CardHeader className="px-6 pt-6">
            <CardTitle className="text-2xl text-slate-950">
              No active promotions
            </CardTitle>
            <CardDescription>
              Attach a promotion template to an event to see it here.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-0">
            <Button asChild className="rounded-full">
              <Link href="/dashboard/promotions/templates">
                Go to templates
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        // Promotion list — one card per EventPromotion doc across all events.
        <div className="space-y-3">
          {promotions.map((promotion) => (
            <Card
              // Use a path-derived key — promotion IDs are only unique within
              // each event's subcollection, not across the whole org.
              key={`${promotion.eventId}:${promotion.id}`}
              className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]"
            >
              <CardContent className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  {/* Promotion name and discount summary */}
                  <p className="text-base font-semibold text-slate-950">
                    {promotion.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {promotion.discountType || "—"} ·{" "}
                    {promotion.discountValue !== null
                      ? promotion.discountValue
                      : "—"}
                  </p>

                  {/* Redemption mode: shows the promo code or an auto-apply indicator */}
                  {promotion.enablePromoCode ? (
                    <Badge
                      variant="outline"
                      className="gap-1 border-orange-200 bg-orange-50 text-orange-700"
                    >
                      <Tag className="h-3 w-3" />
                      Code: {promotion.promoCode}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700"
                    >
                      <Zap className="h-3 w-3" />
                      Auto-apply
                    </Badge>
                  )}

                  {/* Condition badges — one per rule, human-readable (e.g. "Age ≥ 60") */}
                  {promotion.conditions.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {promotion.conditions.map((rule, idx) => (
                        <Badge
                          key={idx}
                          variant="secondary"
                          className="text-xs font-normal"
                        >
                          {formatConditionRule(rule)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right side: event name link and inherit status */}
                <div className="flex shrink-0 flex-col items-end gap-2 text-right">
                  <Link
                    href={`/dashboard/events/${promotion.eventId}`}
                    className="text-sm font-medium text-slate-700 hover:text-slate-950 hover:underline"
                  >
                    {promotion.eventName}
                  </Link>
                  <p className="text-xs text-slate-400">
                    {promotion.inheritFromParent
                      ? "Inherits from template"
                      : "Custom — overrides template"}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
