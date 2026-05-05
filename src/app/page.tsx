import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Compass,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
  CheckCircle2
} from "lucide-react";

import { cn } from "@/lib/utils";

const featureCards = [
  {
    title: "Create events fast",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    icon: Sparkles,
  },
  {
    title: "Manage every detail",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nunc consequat interdum varius sit amet mattis vulputate.",
    icon: CalendarDays,
  },
  {
    title: "Help guests discover what is public",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Velit aliquet sagittis id consectetur purus ut faucibus.",
    icon: Compass,
  },
] as const;

const steps = [
  {
    number: "01",
    title: "Create",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quis hendrerit dolor magna eget est lorem ipsum.",
  },
  {
    number: "02",
    title: "Publish",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Lectus mauris ultrices eros in cursus turpis massa.",
  },
  {
    number: "03",
    title: "Attend",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Tortor aliquam nulla facilisi cras fermentum odio.",
  },
] as const;

const publicEvents = [
  {
    title: "City Sessions",
    date: "May 24",
    location: "Singapore",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer feugiat scelerisque varius morbi enim.",
  },
  {
    title: "Makers Market",
    date: "June 02",
    location: "Kuala Lumpur",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Tellus pellentesque eu tincidunt tortor aliquam.",
  },
  {
    title: "Founders Breakfast",
    date: "June 11",
    location: "Jakarta",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Massa tincidunt dui ut ornare lectus sit amet.",
  },
] as const;

const organizerBenefits = [
  {
    title: "Built for teams and solo hosts",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Egestas fringilla phasellus faucibus scelerisque eleifend.",
    icon: Building2,
  },
  {
    title: "Simple guest-facing discovery",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Volutpat blandit aliquam etiam erat velit scelerisque.",
    icon: Search,
  },
  {
    title: "Clear event operations",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Viverra orci sagittis eu volutpat odio facilisis.",
    icon: ShieldCheck,
  },
] as const;

function PageContainer({
  children,
  className,
}: Readonly<{
  children: React.ReactNode;
  className?: string;
}>) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8 2xl:max-w-[1760px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function SectionIntro({
  eyebrow,
  title,
  body,
  align = "left",
}: Readonly<{
  eyebrow: string;
  title: string;
  body: string;
  align?: "left" | "right";
}>) {
  return (
    <div
      className={cn(
        "space-y-3",
        align === "right" && "xl:justify-self-end xl:text-right",
      )}
    >
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-orange-900">
        {eyebrow}
      </p>
      <h2 className="max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
        {title}
      </h2>
      <p className="max-w-2xl text-base leading-8 text-slate-600">{body}</p>
    </div>
  );
}

function HeroSection() {
  return (
    <section className="pt-28 sm:pt-32">
      <PageContainer>
        <div className="grid items-center gap-12 2xl:grid-cols-[minmax(0,1fr)_minmax(0,620px)] 2xl:gap-20">
          <div className="max-w-4xl">
            <span className="inline-flex items-center rounded-full border border-orange-200 bg-white/85 px-4 py-2 text-sm font-medium text-orange-950 shadow-sm backdrop-blur">
              Simple event management
            </span>
            <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
              Create events, publish them beautifully, and help guests find
              what matters.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600 sm:text-xl">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
              eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut
              enim ad minim veniam, quis nostrud exercitation ullamco laboris.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#ff7a59] px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_-20px_rgba(255,122,89,0.9)] transition hover:bg-[#f46a47] sm:w-auto"
              >
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/events"
                className="inline-flex items-center justify-center rounded-full border border-orange-200 bg-white/85 px-6 py-3 text-sm font-semibold text-slate-900 transition hover:border-orange-300 hover:bg-white sm:w-auto"
              >
                Browse events
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-600">
              <div className="rounded-full border border-white/80 bg-white/80 px-4 py-2 shadow-sm backdrop-blur">
                Public discovery for guests
              </div>
              <div className="rounded-full border border-white/80 bg-white/80 px-4 py-2 shadow-sm backdrop-blur">
                Built for organizations and creators
              </div>
              <div className="rounded-full border border-white/80 bg-white/80 px-4 py-2 shadow-sm backdrop-blur">
                Tailwind-friendly product shell
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-xl 2xl:max-w-none">
            <div className="rounded-[2rem] border border-white/70 bg-white/80 p-4 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.35)] backdrop-blur sm:p-6">
              <div className="rounded-[1.5rem] bg-[linear-gradient(135deg,#fff5eb_0%,#ffffff_45%,#fff1ec_100%)] p-5 sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-500">
                      Event overview
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">
                      Autumn Summit
                    </h2>
                  </div>
                  <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-orange-900 shadow-sm">
                    Public listing
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  {[
                    { label: "Date", value: "June 18" },
                    { label: "Guests", value: "248" },
                    { label: "Status", value: "On track" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-2xl border border-white/80 bg-white/85 p-4"
                    >
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                        {item.label}
                      </p>
                      <p className="mt-2 text-lg font-semibold text-slate-950">
                        {item.value}
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        Lorem ipsum dolor sit amet.
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 grid gap-4">
                  <div className="rounded-3xl border border-orange-100 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-slate-500">
                          Checklist
                        </p>
                        <p className="mt-1 text-lg font-semibold text-slate-950">
                          Organizer tasks
                        </p>
                      </div>
                      <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-950">
                        3 live
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {[
                        ["Venue details", "Done", "0s"],
                        ["Guest reminders", "Today", "1.2s"],
                        ["Speaker updates", "Queued", "2.4s"],
                      ].map(([label, value, delay]) => (
                        <div
                          key={label}
                          className="group flex animate-[taskPulse_4.2s_ease-in-out_infinite] items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700"
                          style={{ animationDelay: delay }}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className="flex h-6 w-6 animate-[checkPop_4.2s_ease-in-out_infinite] items-center justify-center rounded-full bg-orange-100 text-orange-700"
                              style={{ animationDelay: delay }}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </span>
                            <span>{label}</span>
                          </div>

                          <span className="text-slate-500">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-orange-100 bg-[#1f2937] p-5 text-white shadow-sm">
                    <p className="text-sm font-medium text-orange-100">
                      Public feed preview
                    </p>
                    <div className="mt-4 flex items-start justify-between gap-4 rounded-2xl bg-white/10 p-4">
                      <div>
                        <p className="font-semibold">Design Breakfast</p>
                        <p className="mt-2 text-sm text-slate-200">
                          Lorem ipsum dolor sit amet, consectetur adipiscing
                          elit.
                        </p>
                      </div>
                      <Compass className="mt-1 h-5 w-5 text-orange-200" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="pt-20 sm:pt-24">
      <PageContainer className="space-y-8">
        <SectionIntro
          eyebrow="Product highlights"
          title="A calm, capable homepage for an event platform that serves both hosts and guests."
          body="Lorem ipsum dolor sit amet, consectetur adipiscing elit. Risus pretium quam vulputate dignissim suspendisse in est ante in nibh."
        />

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {featureCards.map((feature) => {
            const Icon = feature.icon;

            return (
              <article
                key={feature.title}
                className="rounded-[2rem] border border-white/80 bg-white/85 p-6 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.4)] backdrop-blur"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-900">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-6 text-2xl font-semibold text-slate-950">
                  {feature.title}
                </h3>
                <p className="mt-3 text-base leading-8 text-slate-600">
                  {feature.description}
                </p>
              </article>
            );
          })}
        </div>
      </PageContainer>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section className="pt-20 sm:pt-24">
      <PageContainer>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,1fr))]">
          <div className="rounded-[2rem] border border-orange-100 bg-[#fff1e8] p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-orange-900">
              How it works
            </p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
              Three simple steps, from first draft to full room.
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-600">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Non
              sodales neque sodales ut etiam sit amet nisl purus.
            </p>
          </div>

          {steps.map((step) => (
            <article
              key={step.number}
              className="rounded-[2rem] border border-white/80 bg-white/85 p-6 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.4)] backdrop-blur"
            >
              <p className="text-sm font-semibold text-orange-900">
                {step.number}
              </p>
              <h3 className="mt-4 text-2xl font-semibold text-slate-950">
                {step.title}
              </h3>
              <p className="mt-3 text-base leading-8 text-slate-600">
                {step.description}
              </p>
            </article>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}

function DiscoverySection() {
  return (
    <section id="discover" className="pt-20 sm:pt-24">
      <PageContainer className="space-y-8">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] xl:items-end">
          <SectionIntro
            eyebrow="Public event discovery"
            title="A browseable marketplace feel, designed for guests who just want to find something worth attending."
            body="Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pulvinar pellentesque habitant morbi tristique senectus et netus et."
          />

          <p className="max-w-xl text-base leading-8 text-slate-600 xl:justify-self-end xl:text-right">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pulvinar
            pellentesque habitant morbi tristique senectus et netus et.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {publicEvents.map((event) => (
            <article
              key={event.title}
              className="rounded-[2rem] border border-white/80 bg-white/90 p-6 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.4)] backdrop-blur"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-950">
                  Public event
                </span>
                <Ticket className="h-5 w-5 text-slate-400" />
              </div>
              <h3 className="mt-6 text-3xl font-semibold text-slate-950">
                {event.title}
              </h3>
              <div className="mt-4 space-y-2 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-orange-900" />
                  <span>{event.date}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-orange-900" />
                  <span>{event.location}</span>
                </div>
              </div>
              <p className="mt-5 text-base leading-8 text-slate-600">
                {event.description}
              </p>
              <Link
                href="/events"
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-orange-900 transition hover:text-orange-700"
              >
                Browse public events
                <ArrowRight className="h-4 w-4" />
              </Link>
            </article>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}

function OrganizersSection() {
  return (
    <section id="organizers" className="pt-20 sm:pt-24">
      <PageContainer>
        <div className="grid gap-10 rounded-[2.5rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.86),rgba(255,243,235,0.96))] p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)] backdrop-blur sm:p-8 xl:grid-cols-2">
          <div>
            <SectionIntro
              eyebrow="For organizers"
              title="Keep details tidy, teams aligned, and guests confident."
              body="Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque elit eget gravida cum sociis natoque penatibus et magnis dis parturient."
            />

            <div className="mt-8 space-y-4">
              {organizerBenefits.map((benefit) => {
                const Icon = benefit.icon;

                return (
                  <div
                    key={benefit.title}
                    className="rounded-[1.75rem] border border-white/80 bg-white/90 p-5 shadow-sm"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-100 text-orange-900">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-slate-950">
                          {benefit.title}
                        </h3>
                        <p className="mt-2 text-base leading-8 text-slate-600">
                          {benefit.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[2rem] border border-orange-100 bg-[#1f2937] p-6 text-white shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-orange-100">
                    Team workspace
                  </p>
                  <h3 className="mt-2 text-3xl font-semibold">Launch board</h3>
                </div>
                <Users className="h-6 w-6 text-orange-200" />
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white/10 p-4">
                  <p className="text-sm text-orange-100">Collaborators</p>
                  <p className="mt-2 text-2xl font-semibold">12</p>
                </div>
                <div className="rounded-2xl bg-white/10 p-4">
                  <p className="text-sm text-orange-100">Open tasks</p>
                  <p className="mt-2 text-2xl font-semibold">08</p>
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/80 bg-white/90 p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500">
                Event details snapshot
              </p>
              <div className="mt-5 space-y-3">
                {[
                  ["Venue", "Lorem ipsum dolor sit amet, consectetur adipiscing elit."],
                  [
                    "Guest notes",
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
                  ],
                  [
                    "Visibility",
                    "Public listing enabled with discovery filters.",
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      {label}
                    </p>
                    <p className="mt-2 text-sm text-slate-700">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="pt-20 sm:pt-24">
      <PageContainer>
        <div className="rounded-[2.5rem] bg-[#ff7a59] px-6 py-10 text-white shadow-[0_24px_80px_-44px_rgba(255,122,89,0.85)] sm:px-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-orange-100">
                Final call to action
              </p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
                Plan your next event with less friction and more clarity.
              </h2>
              <p className="mt-4 text-base leading-8 text-orange-50">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
                eiusmod tempor incididunt ut labore et dolore magna aliqua.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#d45132] transition hover:bg-orange-50"
              >
                Get started
              </Link>
              <Link
                href="#features"
                className="inline-flex items-center justify-center rounded-full border border-white/40 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                See the product
              </Link>
            </div>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}

function FooterSection() {
  return (
    <footer className="pt-16 pb-10">
      <PageContainer>
        <div className="flex flex-col gap-4 border-t border-orange-100/80 pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>Eventa, event management made simple.</p>
          <div className="flex flex-wrap gap-5">
            <Link href="/" className="transition hover:text-slate-900">
              About
            </Link>
            <Link href="/" className="transition hover:text-slate-900">
              Contact
            </Link>
            <Link href="/" className="transition hover:text-slate-900">
              Privacy
            </Link>
          </div>
        </div>
      </PageContainer>
    </footer>
  );
}

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#fff8f1] text-slate-900">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-[44rem] bg-[radial-gradient(circle_at_top,_rgba(255,145,77,0.24),_transparent_58%)]"
      />
      <div
        aria-hidden="true"
        className="absolute left-[-8rem] top-28 -z-10 h-72 w-72 rounded-full bg-orange-200/60 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute right-[-5rem] top-72 -z-10 h-64 w-64 rounded-full bg-rose-200/60 blur-3xl"
      />

      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <DiscoverySection />
      <OrganizersSection />
      <CtaSection />
      <FooterSection />
    </main>
  );
}
