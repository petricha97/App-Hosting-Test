// Pricing screen (M2). Server Component: verifies org ownership (404 on
// cross-org), fetches fees + taxes + tickets + registration types +
// promotions via the admin DAL, serializes them, and renders the client
// workspace. ?tab= deep links resolve server-side so the right tab renders
// without a flash.
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getDashboardScope } from "@/features/dashboard/server/get-dashboard-scope";
import { PricingWorkspace } from "@/features/pricing/components/pricing-workspace";
import {
  serializeDiscount,
  serializeFee,
  serializeTax,
  type SerializedDiscount,
  type SerializedFee,
  type SerializedTax,
} from "@/features/pricing/types";
import { resolvePricingTab } from "@/features/pricing/utils";
import {
  serializeRegistrationType,
  serializeTicketType,
  type SerializedRegistrationType,
  type SerializedTicketType,
} from "@/features/registration/types";
import { resolveEventTimeZone } from "@/features/registration/utils";
import { getAdminEventForOrganization } from "@/lib/db/adminEvent";
import { getAdminEventPromotionsForEvent } from "@/lib/db/adminEventPromotion";
import { getAdminFeesForEvent } from "@/lib/db/adminFee";
import { getAdminRegistrationTypesForEvent } from "@/lib/db/adminRegistrationType";
import { getAdminTaxesForEvent } from "@/lib/db/adminTax";
import { getAdminTicketTypesForEvent } from "@/lib/db/adminTicketType";

export const metadata: Metadata = {
  title: "Pricing | Eventa",
};

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

export default async function EventPricingPage({
  params,
  searchParams,
}: PageProps) {
  const [{ eventId }, { tab }] = await Promise.all([params, searchParams]);
  const scope = await getDashboardScope();
  const event = await getAdminEventForOrganization(
    eventId,
    scope.organizationId,
  );

  if (!event) {
    notFound();
  }

  let fees: SerializedFee[] = [];
  let taxes: SerializedTax[] = [];
  let discounts: SerializedDiscount[] = [];
  let tickets: SerializedTicketType[] = [];
  let registrationTypes: SerializedRegistrationType[] = [];
  let loadError = false;
  try {
    const [feeDocs, taxDocs, promotionDocs, ticketDocs, registrationTypeDocs] =
      await Promise.all([
        getAdminFeesForEvent({ eventId, organizationId: scope.organizationId }),
        getAdminTaxesForEvent({
          eventId,
          organizationId: scope.organizationId,
        }),
        getAdminEventPromotionsForEvent(eventId, scope.organizationId),
        getAdminTicketTypesForEvent({
          eventId,
          organizationId: scope.organizationId,
        }),
        getAdminRegistrationTypesForEvent({
          eventId,
          organizationId: scope.organizationId,
        }),
      ]);
    fees = feeDocs.map(serializeFee);
    taxes = taxDocs.map(serializeTax);
    // Subcollection reads carry no orderBy — stabilize on creation time.
    discounts = promotionDocs
      .map(serializeDiscount)
      .sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
    tickets = ticketDocs.map(serializeTicketType);
    registrationTypes = registrationTypeDocs.map(serializeRegistrationType);
  } catch {
    // Shell + tabs stay interactive; each tab shows a retryable error panel.
    loadError = true;
  }

  return (
    <PricingWorkspace
      eventId={eventId}
      initialTab={resolvePricingTab(Array.isArray(tab) ? tab[0] : tab)}
      fees={fees}
      discounts={discounts}
      taxes={taxes}
      tickets={tickets}
      registrationTypes={registrationTypes}
      timeZone={resolveEventTimeZone(event.timezone)}
      loadError={loadError}
    />
  );
}
