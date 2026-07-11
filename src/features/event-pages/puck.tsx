"use client";
/* eslint-disable react/display-name */

import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EventRegistrationFormCard } from "@/features/form/components/event-registration-form-card";
import type { EventPageAsset } from "@/features/event-pages/assets";
import {
  CountdownBlock,
  COUNTDOWN_DEFAULT_COMPLETED_MESSAGE,
} from "@/features/event-pages/blocks/countdown";
import { RegistrationCtaCard } from "@/features/event-pages/blocks/registration-cta";
import {
  PRICING_TABLE_DEFAULT_EMPTY_MESSAGE,
  TicketPricingTableBlock,
} from "@/features/event-pages/blocks/ticket-pricing-table";
import type { PublicPricingProjection } from "@/features/public-registration/types";
import type { SerializedForm } from "@/features/form/utils";
import type { Config, Data } from "@measured/puck";
import { nanoid } from "nanoid";

export type PageMode = "default" | "custom" | "redirect";
export type StarterTemplateKey = "summit" | "wellness" | "creator";
export type LoosePuckData = {
  content?: Array<Record<string, unknown>>;
  root?: Record<string, unknown>;
  zones?: Record<string, unknown>;
};

interface RegistrationRenderOptions {
  title: string;
  body: string;
}

// Countdown injection: eventStartIso is resolved server-side from the event
// doc on every request (M4 AC-9); timezone drives the absolute target label.
export interface EventPageCountdownData {
  eventStartIso: string | null;
  timezone: string;
}

// RegistrationEmbed CTA injection. Pass null/undefined when the event has
// NEVER configured registration paths — the block then keeps rendering the
// legacy inline form (M4 AC-14).
export interface EventPageRegistrationCta {
  state: "open" | "closed";
  registerHref: string;
  variant: "public" | "editor";
  pathsHref?: string;
}

interface CreateEventPagePuckConfigOptions {
  registrationRender?: (options: RegistrationRenderOptions) => ReactElement;
  assets?: EventPageAsset[];
  // Live pricing projection for TicketPricingTable. undefined/null → the
  // block renders its empty state (also the AC-8 fetch-failure degrade).
  pricingTickets?: PublicPricingProjection | null;
  countdown?: EventPageCountdownData | null;
  registrationCta?: EventPageRegistrationCta | null;
  // Editor-only hints on data-bound blocks (empty-state guidance, past-target
  // chip). Never set on the public page.
  editorHints?: boolean;
}

function SharedRegistrationPlaceholder({
  title,
  body,
}: RegistrationRenderOptions) {
  return (
    <section className="rounded-[2rem] border border-dashed border-orange-300 bg-orange-50/70 px-6 py-8 sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-900">
        Registration embed
      </p>
      <h3 className="mt-3 text-2xl font-semibold text-slate-950">{title}</h3>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">{body}</p>
      <div className="mt-5 rounded-[1.5rem] border border-orange-200 bg-white px-5 py-6 text-sm leading-7 text-slate-600">
        In the real implementation, this block renders the published event
        registration form and submission flow.
      </div>
    </section>
  );
}

export const starterTemplates: Record<
  StarterTemplateKey,
  {
    label: string;
    description: string;
    data: LoosePuckData;
  }
> = {
  summit: {
    label: "Summit landing",
    description: "Hero, highlights, schedule, FAQ, and registration.",
    data: {
      content: [
        {
          id: "summit-hero",
          type: "Hero",
          props: {
            eyebrow: "Conference day",
            heading:
              "Bring your next audience together in one confident page.",
            body:
              "Explain the promise, set expectations, and guide people naturally into registration.",
            primaryCtaLabel: "Register now",
            secondaryCtaLabel: "See the schedule",
            imageUrl:
              "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=80",
          },
        },
        {
          id: "summit-highlights",
          type: "Highlights",
          props: {
            title: "Why people attend",
            intro:
              "A few strong benefits help organizers frame the value of showing up.",
            itemOneTitle: "Curated sessions",
            itemOneBody: "Use this block to explain the shape of the day.",
            itemTwoTitle: "Simple venue details",
            itemTwoBody: "Make directions, arrival time, and expectations clear.",
            itemThreeTitle: "Fast registration",
            itemThreeBody:
              "Keep the signup step present without overwhelming the page.",
          },
        },
        {
          id: "summit-schedule",
          type: "Schedule",
          props: {
            title: "What the day looks like",
            agenda:
              "09:00 Doors open\n10:00 Keynote and host welcome\n12:30 Networking lunch\n14:00 Breakout sessions\n16:15 Closing Q&A",
          },
        },
        {
          id: "summit-registration",
          type: "RegistrationEmbed",
          props: {
            title: "Save your seat",
            body:
              "This block is where the published event registration form will appear once connected.",
          },
        },
      ],
      root: {},
      zones: {},
    },
  },
  wellness: {
    label: "Wellness retreat",
    description:
      "Editorial hero, story, gallery-style feel, and softer CTA.",
    data: {
      content: [
        {
          id: "wellness-hero",
          type: "Hero",
          props: {
            eyebrow: "Weekend wellness",
            heading:
              "A calmer event page that feels restorative before the first class begins.",
            body:
              "Use this style when the event is experiential and the page should feel inviting instead of salesy.",
            primaryCtaLabel: "Reserve a place",
            secondaryCtaLabel: "Explore the experience",
            imageUrl:
              "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=1200&q=80",
          },
        },
        {
          id: "wellness-story",
          type: "Story",
          props: {
            title: "What guests can expect",
            body:
              "Blend narrative copy, practical details, and one or two quiet image moments so the page feels warm without becoming cluttered.",
            imageUrl:
              "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1200&q=80",
            imageSide: "right",
          },
        },
        {
          id: "wellness-faq",
          type: "Faq",
          props: {
            title: "Helpful details",
            questionOne: "Do I need prior experience?",
            answerOne:
              "No. This structure works well for beginner-friendly events too.",
            questionTwo: "What should I bring?",
            answerTwo:
              "Comfortable clothes, a water bottle, and anything the organizer recommends.",
            questionThree: "Will registration stay on this page?",
            answerThree:
              "Yes. The registration block can stay embedded at the bottom.",
          },
        },
        {
          id: "wellness-registration",
          type: "RegistrationEmbed",
          props: {
            title: "Register when you are ready",
            body:
              "The final custom page can keep signup close to the content without overpowering it.",
          },
        },
      ],
      root: {},
      zones: {},
    },
  },
  creator: {
    label: "Creator launch",
    description:
      "Bolder product-style structure for launches, showcases, or workshops.",
    data: {
      content: [
        {
          id: "creator-hero",
          type: "Hero",
          props: {
            eyebrow: "Launch event",
            heading:
              "Show the product, explain the moment, and convert attention into attendance.",
            body:
              "This layout works well when the organizer wants the page to feel more like a polished product launch than a static event flyer.",
            primaryCtaLabel: "Claim a ticket",
            secondaryCtaLabel: "See what is included",
            imageUrl:
              "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80",
          },
        },
        {
          id: "creator-highlights",
          type: "Highlights",
          props: {
            title: "Everything the page should communicate quickly",
            intro:
              "Use structured blocks so organizers can move fast without making the page messy.",
            itemOneTitle: "Clear headline",
            itemOneBody:
              "The organizer controls the copy without editing raw code.",
            itemTwoTitle: "Visual storytelling",
            itemTwoBody:
              "Images and section ordering create a stronger first impression.",
            itemThreeTitle: "Built-in conversion",
            itemThreeBody:
              "The registration block keeps the event workflow connected.",
          },
        },
        {
          id: "creator-cta",
          type: "CallToAction",
          props: {
            title: "Keep the page opinionated but flexible",
            body:
              "This is the sweet spot for your product: enough freedom to feel custom, but enough structure to stay supportable.",
            buttonLabel: "Preview the page",
          },
        },
        {
          id: "creator-registration",
          type: "RegistrationEmbed",
          props: {
            title: "Ready for attendee signup",
            body:
              "Later, this block can render the real published registration form for the event.",
          },
        },
      ],
      root: {},
      zones: {},
    },
  },
};

export const blankCustomData: LoosePuckData = {
  content: [
    {
      id: "hero-blank",
      type: "Hero",
      props: {
        eyebrow: "Custom event page",
        heading:
          "Start with a strong hero, then add the sections your event needs.",
        body:
          "This starts as a draft. Publish it when you want the public event page to use the custom layout.",
        primaryCtaLabel: "Register now",
        secondaryCtaLabel: "Learn more",
        imageUrl:
          "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80",
      },
    },
    {
      id: "registration-blank",
      type: "RegistrationEmbed",
      props: {
        title: "Registration lives here",
        body:
          "In production, this block renders the event's published form and submission flow.",
      },
    },
  ],
  root: {},
  zones: {},
};

export function ensurePuckDataIds(data: LoosePuckData | Data): Data {
  return {
    root: data.root ?? {},
    zones: data.zones ?? {},
    content:
      data.content?.map((item, index) => {
        const nextItem = item as Record<string, unknown> & {
          id?: string;
          type?: string;
          props?: Record<string, unknown> & { id?: string };
        };
        const resolvedId =
          typeof nextItem.props?.id === "string" &&
          nextItem.props.id.trim().length > 0
            ? nextItem.props.id
            : typeof nextItem.id === "string" && nextItem.id.trim().length > 0
              ? nextItem.id
              : `${String(nextItem.type ?? "block").toLowerCase()}-${index + 1}-${nanoid(6)}`;
        const { id: _ignoredId, props, ...rest } = nextItem;

        return {
          ...rest,
          type: String(nextItem.type ?? "Hero"),
          props: {
            ...(props ?? {}),
            id: resolvedId,
          },
        };
      }) ?? [],
  } as Data;
}

export function createEventPagePuckConfig({
  registrationRender,
  assets = [],
  pricingTickets = null,
  countdown = null,
  registrationCta = null,
  editorHints = false,
}: CreateEventPagePuckConfigOptions = {}): Config {
  const renderRegistration = registrationRender ?? SharedRegistrationPlaceholder;
  const createImageField = () => ({
    type: "custom" as const,
    render: ({
      value,
      onChange,
    }: {
      value?: string;
      onChange: (nextValue: string) => void;
    }) => {
      const currentValue = typeof value === "string" ? value : "";
      const matchedAsset =
        assets.find((asset) => asset.url === currentValue) ?? null;

      return (
        <div className="space-y-3">
          <Input
            value={currentValue}
            placeholder="https://..."
            onChange={(event) => onChange(event.target.value)}
          />
          {assets.length > 0 ? (
            <label className="space-y-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
              <span>Use uploaded image</span>
              <select
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 shadow-sm"
                value={matchedAsset?.url ?? ""}
                onChange={(event) => onChange(event.target.value)}
              >
                <option value="">Choose an uploaded asset</option>
                {assets.map((asset) => (
                  <option key={asset.path} value={asset.url}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {currentValue ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentValue}
                alt="Selected asset preview"
                className="aspect-[4/3] w-full object-cover"
              />
            </div>
          ) : null}
        </div>
      );
    },
  });

  return {
    // Palette grouping (design §4): the brand-highlighted Registration
    // cluster mirrors the prototype.
    categories: {
      content: {
        title: "Content",
        components: [
          "Hero",
          "Highlights",
          "Story",
          "Schedule",
          "Faq",
          "CallToAction",
        ],
      },
      registration: {
        title: "Registration",
        components: ["RegistrationEmbed", "TicketPricingTable", "CountdownTimer"],
      },
    },
    components: {
      Hero: {
        fields: {
          eyebrow: { type: "text" },
          heading: { type: "textarea" },
          body: { type: "textarea" },
          primaryCtaLabel: { type: "text" },
          secondaryCtaLabel: { type: "text" },
          imageUrl: createImageField(),
        },
        defaultProps: {
          eyebrow: "Custom event page",
          heading: "Welcome to the event",
          body: "Use this hero to explain the event and drive people into registration.",
          primaryCtaLabel: "Register now",
          secondaryCtaLabel: "Learn more",
          imageUrl: "",
        },
        render: ({
          eyebrow,
          heading,
          body,
          primaryCtaLabel,
          secondaryCtaLabel,
          imageUrl,
        }) => (
          <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(255,162,117,0.22),_transparent_45%),linear-gradient(180deg,#fff8f2_0%,#fffdfb_100%)]">
            <div className="grid gap-6 px-6 py-8 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-900">
                  {String(eyebrow ?? "")}
                </p>
                <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                  {String(heading ?? "")}
                </h2>
                <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
                  {String(body ?? "")}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <span className="inline-flex items-center rounded-full bg-[#ff7a59] px-5 py-3 text-sm font-semibold text-white shadow-sm">
                    {String(primaryCtaLabel ?? "")}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">
                    {String(secondaryCtaLabel ?? "")}
                  </span>
                </div>
              </div>

              <div className="relative">
                <div className="aspect-[4/3] overflow-hidden rounded-[1.75rem] border border-white/70 bg-slate-100 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.45)]">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={String(heading ?? "Event image")}
                      className="h-full w-full object-cover"
                      src={String(imageUrl)}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">
                      Add a hero image URL
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        ),
      },
      Highlights: {
        fields: {
          title: { type: "text" },
          intro: { type: "textarea" },
          itemOneTitle: { type: "text" },
          itemOneBody: { type: "textarea" },
          itemTwoTitle: { type: "text" },
          itemTwoBody: { type: "textarea" },
          itemThreeTitle: { type: "text" },
          itemThreeBody: { type: "textarea" },
        },
        render: ({
          title,
          intro,
          itemOneTitle,
          itemOneBody,
          itemTwoTitle,
          itemTwoBody,
          itemThreeTitle,
          itemThreeBody,
        }) => (
          <section className="rounded-[2rem] border border-slate-200 bg-white px-6 py-8 sm:px-8">
            <div className="max-w-2xl">
              <h3 className="text-2xl font-semibold text-slate-950">
                {String(title ?? "")}
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {String(intro ?? "")}
              </p>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {[
                [itemOneTitle, itemOneBody],
                [itemTwoTitle, itemTwoBody],
                [itemThreeTitle, itemThreeBody],
              ].map(([itemTitle, itemBody], index) => (
                <div
                  key={`highlight-${index}`}
                  className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5"
                >
                  <p className="text-base font-semibold text-slate-950">
                    {String(itemTitle ?? "")}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    {String(itemBody ?? "")}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ),
      },
      Story: {
        fields: {
          title: { type: "text" },
          body: { type: "textarea" },
          imageUrl: createImageField(),
          imageSide: {
            type: "radio",
            options: [
              { label: "Left", value: "left" },
              { label: "Right", value: "right" },
            ],
          },
        },
        defaultProps: {
          imageSide: "right",
        },
        render: ({ title, body, imageUrl, imageSide }) => (
          <section className="rounded-[2rem] border border-slate-200 bg-white px-6 py-8 sm:px-8">
            <div
              className={`grid gap-6 lg:grid-cols-2 lg:items-center ${
                imageSide === "left" ? "lg:[&>*:first-child]:order-2" : ""
              }`}
            >
              <div>
                <h3 className="text-2xl font-semibold text-slate-950">
                  {String(title ?? "")}
                </h3>
                <p className="mt-4 text-sm leading-7 text-slate-600">
                  {String(body ?? "")}
                </p>
              </div>
              <div className="aspect-[4/3] overflow-hidden rounded-[1.75rem] border border-slate-200 bg-slate-100">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={String(title ?? "Story image")}
                    className="h-full w-full object-cover"
                    src={String(imageUrl)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    Add a story image URL
                  </div>
                )}
              </div>
            </div>
          </section>
        ),
      },
      Schedule: {
        fields: {
          title: { type: "text" },
          agenda: { type: "textarea" },
        },
        render: ({ title, agenda }) => (
          <section className="rounded-[2rem] border border-slate-200 bg-white px-6 py-8 sm:px-8">
            <h3 className="text-2xl font-semibold text-slate-950">
              {String(title ?? "")}
            </h3>
            <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-600 whitespace-pre-line">
              {String(agenda ?? "")}
            </div>
          </section>
        ),
      },
      Faq: {
        fields: {
          title: { type: "text" },
          questionOne: { type: "text" },
          answerOne: { type: "textarea" },
          questionTwo: { type: "text" },
          answerTwo: { type: "textarea" },
          questionThree: { type: "text" },
          answerThree: { type: "textarea" },
        },
        render: ({
          title,
          questionOne,
          answerOne,
          questionTwo,
          answerTwo,
          questionThree,
          answerThree,
        }) => (
          <section className="rounded-[2rem] border border-slate-200 bg-white px-6 py-8 sm:px-8">
            <h3 className="text-2xl font-semibold text-slate-950">
              {String(title ?? "")}
            </h3>
            <div className="mt-6 space-y-4">
              {[
                [questionOne, answerOne],
                [questionTwo, answerTwo],
                [questionThree, answerThree],
              ].map(([question, answer], index) => (
                <div
                  key={`faq-${index}`}
                  className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5"
                >
                  <p className="text-base font-semibold text-slate-950">
                    {String(question ?? "")}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    {String(answer ?? "")}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ),
      },
      CallToAction: {
        fields: {
          title: { type: "text" },
          body: { type: "textarea" },
          buttonLabel: { type: "text" },
        },
        render: ({ title, body, buttonLabel }) => (
          <section className="rounded-[2rem] bg-[#ff7a59] px-6 py-8 text-white shadow-[0_24px_60px_-42px_rgba(255,122,89,0.6)] sm:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <h3 className="text-2xl font-semibold">{String(title ?? "")}</h3>
                <p className="mt-3 text-sm leading-7 text-orange-50">
                  {String(body ?? "")}
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#ff7a59]">
                {String(buttonLabel ?? "")}
              </span>
            </div>
          </section>
        ),
      },
      // M4-T1: retargeted — same type + title/body props so saved pages load
      // unchanged (AC-16); buttonLabel added with a render-time default for
      // legacy docs. With paths configured it renders the CTA card; with no
      // paths ever it keeps today's inline legacy form (AC-13/14/15).
      RegistrationEmbed: {
        label: "Registration Embed",
        fields: {
          title: { type: "text" },
          body: { type: "textarea" },
          buttonLabel: { type: "text" },
        },
        defaultProps: {
          title: "Save your seat",
          body: "Register for the event in a couple of minutes.",
          buttonLabel: "Register now",
        },
        render: ({ title, body, buttonLabel }) => {
          const resolvedTitle = String(title ?? "");
          const resolvedBody = String(body ?? "");
          // Legacy saved pages carry no buttonLabel prop → default (AC-16).
          const resolvedButtonLabel =
            typeof buttonLabel === "string" && buttonLabel.trim().length > 0
              ? buttonLabel
              : "Register now";

          if (registrationCta) {
            return (
              <RegistrationCtaCard
                title={resolvedTitle}
                body={resolvedBody}
                buttonLabel={resolvedButtonLabel}
                state={registrationCta.state}
                registerHref={registrationCta.registerHref}
                variant={registrationCta.variant}
                pathsHref={registrationCta.pathsHref}
              />
            );
          }

          return renderRegistration({
            title: resolvedTitle,
            body: resolvedBody,
          });
        },
      },
      // M4-T1: live pricing table — data injected, never author-entered or
      // snapshotted (AC-6/19).
      TicketPricingTable: {
        label: "Ticket & Pricing table",
        fields: {
          title: { type: "text" },
          intro: { type: "textarea" },
          emptyMessage: { type: "text" },
        },
        defaultProps: {
          title: "Tickets & pricing",
          intro: "",
          emptyMessage: PRICING_TABLE_DEFAULT_EMPTY_MESSAGE,
        },
        render: ({ title, intro, emptyMessage }) => (
          <TicketPricingTableBlock
            title={String(title ?? "")}
            intro={String(intro ?? "")}
            emptyMessage={String(emptyMessage ?? "")}
            projection={pricingTickets}
            editorHint={editorHints}
          />
        ),
      },
      // M4-T1: countdown to event start or a custom moment (AC-9..12).
      CountdownTimer: {
        label: "Countdown timer",
        fields: {
          title: { type: "text" },
          target: {
            type: "radio",
            options: [
              { label: "Event start", value: "eventStart" },
              { label: "Custom date", value: "custom" },
            ],
          },
          customDateTime: {
            type: "custom",
            label: "Custom date & time",
            render: ({
              value,
              onChange,
            }: {
              value?: string;
              onChange: (nextValue: string) => void;
            }) => (
              <Input
                type="datetime-local"
                value={typeof value === "string" ? value : ""}
                onChange={(event) => onChange(event.target.value)}
              />
            ),
          },
          completedMessage: { type: "text" },
        },
        defaultProps: {
          title: "Event starts in",
          target: "eventStart",
          customDateTime: "",
          completedMessage: COUNTDOWN_DEFAULT_COMPLETED_MESSAGE,
        },
        render: ({ title, target, customDateTime, completedMessage }) => (
          <CountdownBlock
            title={String(title ?? "")}
            target={String(target ?? "eventStart")}
            customDateTime={String(customDateTime ?? "")}
            completedMessage={String(completedMessage ?? "")}
            eventStartIso={countdown?.eventStartIso ?? null}
            timezone={countdown?.timezone ?? "UTC"}
            editorHint={editorHints}
          />
        ),
      },
    },
  };
}

export function createPublicRegistrationRenderer({
  eventId,
  eventName,
  form,
}: {
  eventId: string;
  eventName: string;
  form: SerializedForm | null;
}) {
  return ({ title, body }: RegistrationRenderOptions) => (
    <div className="space-y-4">
      <Badge className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-900 shadow-none">
        Registration embed
      </Badge>
      <EventRegistrationFormCard
        eventId={eventId}
        eventName={eventName}
        form={form}
        submitEndpoint={`/api/events/${eventId}/register`}
        heading={title}
        description={body}
        emptyTitle="Registration is not available yet"
        emptyDescription="This event is public, but the organizer has not published the registration form yet."
        submitLabel="Register now"
      />
    </div>
  );
}

export function createDashboardRegistrationRenderer({
  eventId,
  eventName,
  form,
}: {
  eventId: string;
  eventName: string;
  form: SerializedForm | null;
}) {
  return ({ title, body }: RegistrationRenderOptions) => (
    <div className="space-y-4">
      <Badge className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-900 shadow-none">
        Registration embed
      </Badge>
      <EventRegistrationFormCard
        eventId={eventId}
        eventName={eventName}
        form={form}
        submitEndpoint={`/api/dashboard/events/${eventId}/form/submit`}
        heading={title}
        description={body}
        emptyTitle="No event form saved yet"
        emptyDescription="Open the form builder, save the event form, then this page block will render that same Firestore-backed registration form here."
        submitLabel="Test form submission"
      />
    </div>
  );
}
