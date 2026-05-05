"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Puck, Render, type Config, type Data } from "@measured/puck";
import {
  ArrowRight,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Link2,
  RefreshCcw,
  Sparkles,
} from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";

import { DashboardPageHeader } from "@/features/dashboard/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type PageMode = "default" | "custom" | "redirect";
type StarterTemplateKey = "summit" | "wellness" | "creator";
type LoosePuckData = {
  content?: Array<Record<string, unknown>>;
  root?: Record<string, unknown>;
  zones?: Record<string, unknown>;
};

interface EventPagePrototypeState {
  mode: PageMode;
  redirectUrl: string;
  selectedTemplate: StarterTemplateKey;
  prompt: string;
  draftData: Data;
  publishedData: Data | null;
  publishedAt: string | null;
}

const STORAGE_KEY = "event-pages-prototype-v1";

const mockEvent = {
  id: "event-prototype-gym-2028",
  name: "Gym2028",
  description:
    "A friendly all-day event for classes, coaching, and community signups.",
  venue: "HarbourFit Studio, Singapore",
  schedule: "Saturday, June 14, 2026 · 9:00 AM to 5:00 PM",
  timezone: "Asia/Singapore",
  capacity: 120,
  expectedGuests: 84,
};

const starterTemplates: Record<
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
            heading: "Bring your next audience together in one confident page.",
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
            itemThreeBody: "Keep the signup step present without overwhelming the page.",
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
    description: "Editorial hero, story, gallery-style feel, and softer CTA.",
    data: {
      content: [
        {
          id: "wellness-hero",
          type: "Hero",
          props: {
            eyebrow: "Weekend wellness",
            heading: "A calmer event page that feels restorative before the first class begins.",
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
            answerOne: "No. This structure works well for beginner-friendly events too.",
            questionTwo: "What should I bring?",
            answerTwo: "Comfortable clothes, a water bottle, and anything the organizer recommends.",
            questionThree: "Will registration stay on this page?",
            answerThree: "Yes. The registration block can stay embedded at the bottom.",
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
    description: "Bolder product-style structure for launches, showcases, or workshops.",
    data: {
      content: [
        {
          id: "creator-hero",
          type: "Hero",
          props: {
            eyebrow: "Launch event",
            heading: "Show the product, explain the moment, and convert attention into attendance.",
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
            itemOneBody: "The organizer controls the copy without editing raw code.",
            itemTwoTitle: "Visual storytelling",
            itemTwoBody: "Images and section ordering create a stronger first impression.",
            itemThreeTitle: "Built-in conversion",
            itemThreeBody: "The registration block keeps the event workflow connected.",
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

const blankCustomData: LoosePuckData = {
  content: [
    {
      id: "hero-blank",
      type: "Hero",
      props: {
        eyebrow: "Custom event page",
        heading: "Start with a strong hero, then add the sections your event needs.",
        body:
          "This prototype uses local storage only. Nothing here is connected to the real event flow yet.",
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
          "In the production version, this block would render the event's published form and submission flow.",
      },
    },
  ],
  root: {},
  zones: {},
};

function ensurePuckDataIds(data: LoosePuckData | Data): Data {
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

function DefaultEventPagePreview() {
  return (
    <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
      <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(255,162,117,0.22),_transparent_45%),linear-gradient(180deg,#fff8f2_0%,#fffdfb_100%)] px-6 py-8 sm:px-8">
        <Badge className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-900 shadow-none">
          Default page preview
        </Badge>
        <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          {mockEvent.name}
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
          {mockEvent.description}
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-600">
          <span className="rounded-full border border-slate-200 bg-white px-4 py-2">
            {mockEvent.schedule}
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-4 py-2">
            {mockEvent.venue}
          </span>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-8 sm:px-8 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="rounded-[1.5rem] border-slate-200 bg-slate-50/80 shadow-none">
          <CardHeader>
            <CardTitle className="text-xl text-slate-950">
              Generic public event layout
            </CardTitle>
            <CardDescription>
              This is the safe fallback page for organizers who do not want to
              design their own experience.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-7 text-slate-600">
            <p>
              Keep this version fast, readable, and conversion-friendly. It can
              always be the baseline while the CMS layer evolves.
            </p>
            <p>
              In production, this area would show the public event content plus
              the published registration form when available.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-[1.5rem] border-slate-200 bg-white shadow-none">
          <CardHeader>
            <CardTitle className="text-xl text-slate-950">
              Event facts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Timezone
              </p>
              <p className="mt-2">{mockEvent.timezone}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Capacity
              </p>
              <p className="mt-2">{mockEvent.capacity} guests</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Registration embed
              </p>
              <p className="mt-2">
                The real form will still live on the page, even when the page
                uses the default layout.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function EventPagesPrototype() {
  const [isReady, setIsReady] = useState(false);
  const [state, setState] = useState<EventPagePrototypeState>({
    mode: "default",
    redirectUrl: "https://example.com/my-own-event-site",
    selectedTemplate: "summit",
    prompt: "",
    draftData: ensurePuckDataIds(blankCustomData),
    publishedData: null,
    publishedAt: null,
  });

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);

    if (saved) {
      try {
        const parsed = JSON.parse(saved) as EventPagePrototypeState;
        setState({
          ...parsed,
          draftData: ensurePuckDataIds(parsed.draftData),
          publishedData: parsed.publishedData
            ? ensurePuckDataIds(parsed.publishedData)
            : null,
        });
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [isReady, state]);

  const puckConfig = useMemo<Config>(() => {
    return {
      components: {
        Hero: {
          fields: {
            eyebrow: { type: "text" },
            heading: { type: "textarea" },
            body: { type: "textarea" },
            primaryCtaLabel: { type: "text" },
            secondaryCtaLabel: { type: "text" },
            imageUrl: { type: "text" },
          },
          defaultProps: {
            eyebrow: "Custom event page",
            heading: mockEvent.name,
            body: mockEvent.description,
            primaryCtaLabel: "Register now",
            secondaryCtaLabel: "See details",
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
                    {eyebrow}
                  </p>
                  <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                    {heading}
                  </h2>
                  <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
                    {body}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <span className="inline-flex items-center rounded-full bg-[#ff7a59] px-5 py-3 text-sm font-semibold text-white shadow-sm">
                      {primaryCtaLabel}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">
                      {secondaryCtaLabel}
                    </span>
                  </div>
                </div>

                <div className="relative">
                  <div className="aspect-[4/3] overflow-hidden rounded-[1.75rem] border border-white/70 bg-slate-100 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.45)]">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={heading}
                        className="h-full w-full object-cover"
                        src={imageUrl}
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
                <h3 className="text-2xl font-semibold text-slate-950">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{intro}</p>
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {[
                  [itemOneTitle, itemOneBody],
                  [itemTwoTitle, itemTwoBody],
                  [itemThreeTitle, itemThreeBody],
                ].map(([itemTitle, itemBody]) => (
                  <div
                    key={itemTitle}
                    className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5"
                  >
                    <p className="text-base font-semibold text-slate-950">{itemTitle}</p>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{itemBody}</p>
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
            imageUrl: { type: "text" },
            imageSide: {
              type: "radio",
              options: [
                { label: "Left", value: "left" },
                { label: "Right", value: "right" },
              ],
            },
          },
          render: ({ title, body, imageUrl, imageSide }) => (
            <section className="rounded-[2rem] border border-slate-200 bg-white px-6 py-8 sm:px-8">
              <div
                className={cn(
                  "grid gap-6 lg:grid-cols-2 lg:items-center",
                  imageSide === "left" && "lg:[&>*:first-child]:order-2",
                )}
              >
                <div>
                  <h3 className="text-2xl font-semibold text-slate-950">{title}</h3>
                  <p className="mt-4 text-sm leading-7 text-slate-600">{body}</p>
                </div>
                <div className="aspect-[4/3] overflow-hidden rounded-[1.75rem] border border-slate-200 bg-slate-100">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={title}
                      className="h-full w-full object-cover"
                      src={imageUrl}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">
                      Add a section image URL
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
            <section className="rounded-[2rem] border border-slate-200 bg-slate-950 px-6 py-8 text-white sm:px-8">
              <h3 className="text-2xl font-semibold">{title}</h3>
              <div className="mt-5 rounded-[1.5rem] bg-white/8 p-5 text-sm leading-7 text-slate-100 whitespace-pre-line">
                {agenda}
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
              <h3 className="text-2xl font-semibold text-slate-950">{title}</h3>
              <div className="mt-6 space-y-4">
                {[
                  [questionOne, answerOne],
                  [questionTwo, answerTwo],
                  [questionThree, answerThree],
                ].map(([question, answer]) => (
                  <div
                    key={question}
                    className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5"
                  >
                    <p className="text-base font-semibold text-slate-950">{question}</p>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{answer}</p>
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
                  <h3 className="text-2xl font-semibold">{title}</h3>
                  <p className="mt-3 text-sm leading-7 text-orange-50">{body}</p>
                </div>
                <span className="inline-flex items-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#ff7a59]">
                  {buttonLabel}
                </span>
              </div>
            </section>
          ),
        },
        RegistrationEmbed: {
          fields: {
            title: { type: "text" },
            body: { type: "textarea" },
          },
          render: ({ title, body }) => (
            <section className="rounded-[2rem] border border-dashed border-orange-300 bg-orange-50/70 px-6 py-8 sm:px-8">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-900">
                Registration embed
              </p>
              <h3 className="mt-3 text-2xl font-semibold text-slate-950">{title}</h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">{body}</p>
              <div className="mt-5 rounded-[1.5rem] border border-orange-200 bg-white px-5 py-6 text-sm leading-7 text-slate-600">
                In the real implementation, this block would render the event’s
                published registration form and submission flow.
              </div>
            </section>
          ),
        },
      },
    };
  }, []);

  function updateState(patch: Partial<EventPagePrototypeState>) {
    setState((current) => ({ ...current, ...patch }));
  }

  function applyStarterTemplate(key: StarterTemplateKey) {
    updateState({
      mode: "custom",
      selectedTemplate: key,
      draftData: ensurePuckDataIds(starterTemplates[key].data),
    });

    toast.success("Starter template applied", {
      description: `${starterTemplates[key].label} is now loaded in the custom editor.`,
    });
  }

  function generateFromPrompt() {
    const prompt = state.prompt.trim();

    if (!prompt) {
      toast.error("Add a prompt first", {
        description: "Describe the kind of event page you want to generate.",
      });
      return;
    }

    const nextTemplate = /wellness|retreat|fitness|calm|yoga/i.test(prompt)
      ? "wellness"
      : /creator|launch|product|showcase/i.test(prompt)
        ? "creator"
        : "summit";

    const starter = starterTemplates[nextTemplate];
    const generatedData: LoosePuckData = {
      ...starter.data,
      content: starter.data.content?.map((item, index) => {
        if (index !== 0 || item.type !== "Hero") {
          return item;
        }

        const heroItem = item as Record<string, unknown> & {
          props?: Record<string, unknown>;
        };

        return {
          ...heroItem,
          props: {
            ...(heroItem.props ?? {}),
            heading: `${mockEvent.name}: ${prompt}`,
            body:
              "Prototype AI mode: this locally generated draft chooses a starting template and rewrites the hero so the organizer can edit from there.",
          },
        };
      }),
    };

    updateState({
      mode: "custom",
      selectedTemplate: nextTemplate,
      draftData: ensurePuckDataIds(generatedData),
    });

    toast.success("Draft generated", {
      description:
        "This prototype uses local heuristics for now, but the flow mirrors a future AI-assisted page start.",
    });
  }

  function handlePublish(data: Data) {
    const normalizedData = ensurePuckDataIds(data);
    const publishedAt = new Date().toISOString();

    updateState({
      draftData: normalizedData,
      publishedData: normalizedData,
      publishedAt,
    });

    toast.success("Prototype page published locally", {
      description:
        "This stores the current custom page in local storage only. No event data was changed.",
    });
  }

  function resetPrototype() {
    const nextState: EventPagePrototypeState = {
      mode: "default",
      redirectUrl: "https://example.com/my-own-event-site",
      selectedTemplate: "summit",
      prompt: "",
      draftData: ensurePuckDataIds(blankCustomData),
      publishedData: null,
      publishedAt: null,
    };

    setState(nextState);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    toast.success("Prototype reset", {
      description: "The local event-page playground has been reset to its starting state.",
    });
  }

  if (!isReady) {
    return null;
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Prototype"
        title="Event Pages Playground"
        description="Pressure-test the `default`, `custom`, and `redirect` event page modes before wiring them into real events. This route saves locally only."
        actions={
          <>
            <Badge className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-900 shadow-none">
              Prototype only
            </Badge>
            <Button asChild variant="outline">
              <Link href="/dashboard/events">Back to events</Link>
            </Button>
            <Button type="button" variant="outline" onClick={resetPrototype}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Reset prototype
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-2xl text-slate-950">
                Page mode
              </CardTitle>
              <CardDescription>
                Choose how the public event page behaves without touching the
                live event model yet.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-6 pb-6 pt-0">
              {([
                ["default", "Use the app’s generic public event layout", LayoutTemplate],
                ["custom", "Design a page inside the app", ImageIcon],
                ["redirect", "Send visitors to your own external page", Link2],
              ] as const).map(([mode, description, Icon]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => updateState({ mode })}
                  className={cn(
                    "w-full rounded-[1.5rem] border p-4 text-left transition",
                    state.mode === mode
                      ? "border-orange-300 bg-orange-50/70"
                      : "border-slate-200 bg-slate-50/80 hover:border-slate-300",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-orange-900 shadow-sm">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold capitalize text-slate-950">
                        {mode}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {description}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-2xl text-slate-950">
                Starter templates
              </CardTitle>
              <CardDescription>
                These mimic the kind of ready-made layouts organizers could
                choose before editing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-6 pb-6 pt-0">
              {(Object.entries(starterTemplates) as [
                StarterTemplateKey,
                (typeof starterTemplates)[StarterTemplateKey],
              ][]).map(([key, template]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyStarterTemplate(key)}
                  className={cn(
                    "w-full rounded-[1.5rem] border p-4 text-left transition",
                    state.selectedTemplate === key
                      ? "border-orange-300 bg-orange-50/70"
                      : "border-slate-200 bg-slate-50/80 hover:border-slate-300",
                  )}
                >
                  <p className="text-sm font-semibold text-slate-950">
                    {template.label}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {template.description}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-2xl text-slate-950">
                    Prompt-to-page stub
                  </CardTitle>
                  <CardDescription>
                    Prototype the future AI flow without wiring a model call yet.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6 pt-0">
              <Textarea
                rows={5}
                className="rounded-[1.5rem] border-slate-200 bg-slate-50"
                placeholder="Create a calm wellness event page with a welcoming hero, practical schedule, and registration section."
                value={state.prompt}
                onChange={(event) => updateState({ prompt: event.target.value })}
              />
              <Button type="button" onClick={generateFromPrompt}>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate local draft
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
            <CardHeader className="px-6 pt-6">
              <CardTitle className="text-2xl text-slate-950">
                Mock event context
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-6 pb-6 pt-0 text-sm text-slate-600">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
                <p className="font-semibold text-slate-950">{mockEvent.name}</p>
                <p className="mt-2 leading-7">{mockEvent.schedule}</p>
                <p className="mt-1 leading-7">{mockEvent.venue}</p>
              </div>
              <p>Last published: {state.publishedAt ?? "Not published yet"}</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {state.mode === "default" ? (
            <DefaultEventPagePreview />
          ) : null}

          {state.mode === "redirect" ? (
            <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
              <CardHeader className="px-6 pt-6">
                <CardTitle className="text-2xl text-slate-950">
                  Redirect mode prototype
                </CardTitle>
                <CardDescription>
                  In production, a published event in redirect mode would send
                  public visitors to the organizer’s external event page.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 px-6 pb-6 pt-0">
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  <span>External URL</span>
                  <Input
                    className="h-12 rounded-2xl border-slate-200 bg-slate-50"
                    value={state.redirectUrl}
                    onChange={(event) =>
                      updateState({ redirectUrl: event.target.value })
                    }
                  />
                </label>
                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
                  <p className="text-sm font-semibold text-slate-950">
                    Redirect preview
                  </p>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    Public users would be redirected to:
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <ExternalLink className="h-4 w-4 text-orange-900" />
                    <span className="break-all">{state.redirectUrl}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {state.mode === "custom" ? (
            <>
              <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
                <CardHeader className="px-6 pt-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-900">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl text-slate-950">
                        Custom page editor
                      </CardTitle>
                      <CardDescription>
                        Prototype the event-page editing experience with Puck
                        before connecting it to real event data and Firebase
                        storage.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-0 pb-0 pt-0">
                  <Puck
                    config={puckConfig}
                    data={state.draftData}
                    headerTitle={`${mockEvent.name} page prototype`}
                    onChange={(data) =>
                      updateState({ draftData: ensurePuckDataIds(data) })
                    }
                    onPublish={handlePublish}
                  />
                </CardContent>
              </Card>

              <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
                <CardHeader className="px-6 pt-6">
                  <CardTitle className="text-2xl text-slate-950">
                    Public render preview
                  </CardTitle>
                  <CardDescription>
                    This is how the current draft would render as a public event
                    page using approved blocks only.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 px-6 pb-6 pt-0">
                  <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-4 text-sm leading-7 text-slate-600">
                    The publish button inside the editor saves a local published
                    snapshot only. No real event or database document is touched
                    in this prototype.
                  </div>
                  <div className="space-y-6">
                    <Render config={puckConfig} data={state.draftData} />
                  </div>
                  {state.publishedData ? (
                    <div className="space-y-4 rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">
                            Published snapshot
                          </p>
                          <p className="mt-1 text-sm leading-6 text-slate-600">
                            Saved locally at {state.publishedAt}
                          </p>
                        </div>
                        <Badge className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-900 shadow-none">
                          Published
                        </Badge>
                      </div>
                      <div className="space-y-6">
                        <Render config={puckConfig} data={state.publishedData} />
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      </div>

      <Card className="rounded-[2rem] border-white/70 bg-white/92 py-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.35)]">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-2xl text-slate-950">
            What this prototype is proving
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 px-6 pb-6 pt-0 md:grid-cols-3">
          {[
            "A constrained block editor can give organizers flexibility without exposing raw HTML or full page-builder chaos.",
            "The product can support default, custom, and redirect modes without changing the public `/events/[eventId]` contract yet.",
            "Future AI can generate block-based draft pages first, then hand editing over to the organizer in a visual builder.",
          ].map((point) => (
            <div
              key={point}
              className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5 text-sm leading-7 text-slate-600"
            >
              {point}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href="/dashboard/forms/templates">
            Explore form templates next
          </Link>
        </Button>
        <Button asChild>
          <Link href="/dashboard/events">
            Back to dashboard events
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
