// Public registration entry (M3-T3 AC-1):
//   0 active paths  → redirect to the event page, where the legacy flat form
//                     keeps working exactly as today (backward compat);
//   1 active path   → server redirect straight into the stepper (no picker
//                     flash);
//   2+ active paths → path picker, ordered by sortOrder;
//   ?path= given    → must be an ACTIVE path of this event, else 404.
// Event must be Published with a published form — otherwise the designed
// "registration not available" state renders.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { extractOrganizationIdFromPath } from "@/features/event/utils";
import { getNonCommerceFields, type FormFieldValues } from "@/features/form/schema";
import { serializeForm } from "@/features/form/utils";
import {
  PathPickerPage,
  type PathPickerItem,
} from "@/features/public-registration/components/path-picker-page";
import { RegistrationStepper } from "@/features/public-registration/components/registration-stepper";
import type {
  CommerceFieldConfig,
  SerializedFlowPath,
} from "@/features/public-registration/types";
import { getAdminPublishedEventById } from "@/lib/db/adminEvent";
import { getAdminPublishedFormForPublicEvent } from "@/lib/db/adminForm";
import { getAdminActiveRegistrationPathsForEvent } from "@/lib/db/adminRegistrationPath";
import { getAdminRegistrationTypesForEvent } from "@/lib/db/adminRegistrationType";

interface RegisterPageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ path?: string }>;
}

function toCommerceConfig(
  field: FormFieldValues | undefined,
  fallbackLabel: string,
): CommerceFieldConfig | null {
  if (!field) return null;
  return {
    label: field.label || fallbackLabel,
    helpText: field.helpText ?? "",
    placeholder: field.placeholder ?? "",
    required: field.required,
  };
}

export default async function PublicRegisterPage({
  params,
  searchParams,
}: RegisterPageProps) {
  const { eventId } = await params;
  const { path: pathParam } = await searchParams;

  const event = await getAdminPublishedEventById(eventId);
  if (!event) notFound();

  const organizationId =
    extractOrganizationIdFromPath(event.organizationPath) ?? "";

  const form = await getAdminPublishedFormForPublicEvent({
    eventId,
    eventName: event.name,
    organizationId,
    formPath: event.formPath,
  });

  if (!form) {
    return (
      <main className="min-h-screen bg-[#fff8f1] pb-20 pt-28 text-slate-900 sm:pt-32">
        <div className="mx-auto w-full max-w-2xl space-y-4 px-4">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Registration is not available yet
          </h1>
          <p className="text-base leading-7 text-slate-600">
            This event is public, but the organizer has not published the
            registration form yet.
          </p>
          <Link
            href={`/events/${eventId}`}
            className="inline-flex text-sm font-medium text-orange-900 underline-offset-4 hover:underline"
          >
            Back to the event page
          </Link>
        </div>
      </main>
    );
  }

  const activePaths = await getAdminActiveRegistrationPathsForEvent({
    eventId,
    organizationId,
  });

  // Legacy fallback: no paths configured → the flat single-page form on the
  // event detail page keeps working exactly as today (T3 AC-1).
  if (activePaths.length === 0) {
    redirect(`/events/${eventId}`);
  }

  if (!pathParam) {
    if (activePaths.length === 1) {
      redirect(`/events/${eventId}/register?path=${activePaths[0].id}`);
    }

    const registrationTypes = await getAdminRegistrationTypesForEvent({
      eventId,
      organizationId,
    });
    const typeNameById = new Map(
      registrationTypes.map((type) => [type.id, type.name]),
    );

    const pickerItems: PathPickerItem[] = activePaths.map((path) => ({
      id: path.id,
      name: path.name,
      audienceName: path.audienceRegistrationTypeId
        ? typeNameById.get(path.audienceRegistrationTypeId) ?? null
        : null,
      paymentMethod: path.paymentMethod,
    }));

    return (
      <PathPickerPage
        eventId={eventId}
        eventName={event.name}
        paths={pickerItems}
      />
    );
  }

  // Forced ?path= values must reference an ACTIVE path of this event —
  // inactive/foreign/unknown → 404 (T3 AC-1).
  const selectedPath = activePaths.find((path) => path.id === pathParam);
  if (!selectedPath) notFound();

  const serializedForm = serializeForm(form);
  const fields = serializedForm.fields as FormFieldValues[];
  const questionFields = getNonCommerceFields(fields);

  const flowPath: SerializedFlowPath = {
    id: selectedPath.id,
    name: selectedPath.name,
    paymentMethod: selectedPath.paymentMethod,
    currency: selectedPath.currency,
  };

  return (
    <main className="min-h-screen bg-[#fff8f1] pb-20 pt-28 text-slate-900 sm:pt-32">
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4">
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-orange-900">
            {event.name}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Register
          </h1>
        </div>

        <RegistrationStepper
          eventId={eventId}
          eventName={event.name}
          path={flowPath}
          questionFields={questionFields}
          ticketField={
            toCommerceConfig(
              fields.find((field) => field.type === "ticket-selector"),
              "Select your ticket",
            ) ?? {
              label: "Select your ticket",
              helpText: "",
              placeholder: "",
              required: true,
            }
          }
          promoField={toCommerceConfig(
            fields.find((field) => field.type === "promo-code"),
            "Promo code",
          )}
        />
      </div>
    </main>
  );
}
