"use client";

// Pricing screen shell (M2): header + the four Radix tabs (Fees / Discounts /
// Taxes / Service Fees) with ?tab= URL sync. The server page reads
// searchParams.tab for the initial value so deep links render the right tab
// without a flash; subsequent switches are client-side over pre-fetched data
// (router.replace, no scroll, no navigation).
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiscountsTab } from "@/features/pricing/components/discounts-tab";
import { FeesTab } from "@/features/pricing/components/fees-tab";
import { ServiceFeesTab } from "@/features/pricing/components/service-fees-tab";
import { TaxesTab } from "@/features/pricing/components/taxes-tab";
import type {
  SerializedDiscount,
  SerializedFee,
  SerializedTax,
} from "@/features/pricing/types";
import { resolvePricingTab, type PricingTab } from "@/features/pricing/utils";
import type {
  SerializedRegistrationType,
  SerializedTicketType,
} from "@/features/registration/types";

interface PricingWorkspaceProps {
  eventId: string;
  initialTab: PricingTab;
  fees: SerializedFee[];
  discounts: SerializedDiscount[];
  taxes: SerializedTax[];
  tickets: SerializedTicketType[];
  registrationTypes: SerializedRegistrationType[];
  // Resolved event timezone for validity-window rendering.
  timeZone: string;
  loadError: boolean;
}

export function PricingWorkspace({
  eventId,
  initialTab,
  fees,
  discounts,
  taxes,
  tickets,
  registrationTypes,
  timeZone,
  loadError,
}: PricingWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<PricingTab>(initialTab);

  const handleTabChange = (value: string) => {
    const next = resolvePricingTab(value);
    setTab(next);
    // replace (not push): tab switches are view state, not history entries.
    router.replace(`${pathname}?tab=${next}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Pricing</h1>
        <p className="text-sm text-muted-foreground">
          Fees attach a price to a ticket — per registration type and currency.
        </p>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange} className="gap-6">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="fees">Fees</TabsTrigger>
          <TabsTrigger value="discounts">Discounts</TabsTrigger>
          <TabsTrigger value="taxes">Taxes</TabsTrigger>
          <TabsTrigger value="service-fees">Service Fees</TabsTrigger>
        </TabsList>

        <TabsContent value="fees">
          <FeesTab
            eventId={eventId}
            fees={fees}
            tickets={tickets}
            registrationTypes={registrationTypes}
            loadError={loadError}
          />
        </TabsContent>
        <TabsContent value="discounts">
          <DiscountsTab
            eventId={eventId}
            discounts={discounts}
            timeZone={timeZone}
            loadError={loadError}
          />
        </TabsContent>
        <TabsContent value="taxes">
          <TaxesTab eventId={eventId} taxes={taxes} loadError={loadError} />
        </TabsContent>
        <TabsContent value="service-fees">
          <ServiceFeesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
