"use client";

// Client-side, CANVAS-ONLY Puck registry for the email designer (spec §1,
// design §3.5/§4). File location (spec OQ-5, design "leaves this to
// FS/Implementation"): kept under src/features/emails/components/, a
// sibling file to src/features/event-pages/puck.tsx rather than co-located
// in it — this config is reachable only from the "use client" email-designer
// canvas, and keeping it here matches the same import-boundary story
// src/features/emails/server/* already enforces: the security-critical
// SERVER-side email-safe HTML renderers live under
// src/features/emails/server/blocks/ (Backend scope, `server-only`, NEVER
// this file, NEVER reachable from the web page-builder's client bundle).
//
// "Reuse the shell, not the render output" (Shared decisions): for exactly
// the 8 email-safe types, this reuses createEventPagePuckConfig(...)'s
// `render` closures and `defaultProps` UNMODIFIED (canvas parity — the
// canvas is an APPROXIMATE preview, design §3.3) while rebuilding `fields`
// from scratch. Fields are rebuilt (not reused) for two reasons: (1) every
// text-bearing control needs to report focus into the shared merge-tag
// toolbar (design §3.4), which native Puck "text"/"textarea" fields have no
// hook for — so every text-bearing field becomes a `type: "custom"` field,
// the same technique createImageField already uses for the image-URL
// control; (2) each block's field-panel divergence note (design §4 table)
// is appended as a synthetic `type: "custom"` field bound to a throwaway
// prop key.
import type { MutableRefObject } from "react";
import type { Config } from "@measured/puck";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmailBlockFieldNote } from "@/features/emails/components/email-block-field-note";
import { EMAIL_SAFE_BLOCK_TYPES } from "@/features/emails/types";
import { createEventPagePuckConfig } from "@/features/event-pages/puck";

export type MergeTagFocusTarget = HTMLInputElement | HTMLTextAreaElement;

// Populated by whichever text-bearing custom field last had focus (design
// §3.4: "every text-bearing custom field's onFocus writes itself into" the
// shared ref). `elementRef` is exactly the ref shape MergeTagMenu's
// generalized `textareaRef` prop accepts — used both for cursor-position
// reads and to hand back to MergeTagMenu directly. `onChangeRef` is the
// implementation detail the design doc's prose doesn't spell out: Puck
// hands each custom field a fresh, path-scoped `onChange` closure, so
// inserting a tag into "whichever field is focused" requires capturing THAT
// exact callback alongside the DOM node, not just the node — a plain DOM
// value mutation would never reach Puck's own controlled state.
export interface MergeTagFocusController {
  elementRef: MutableRefObject<MergeTagFocusTarget | null>;
  onChangeRef: MutableRefObject<((next: string) => void) | null>;
  onFieldFocused: () => void;
}

interface CreateEmailPuckConfigOptions {
  focusController: MergeTagFocusController;
}

function createFocusTrackedTextField(focusController: MergeTagFocusController) {
  return {
    type: "custom" as const,
    render: ({
      value,
      onChange,
    }: {
      value?: string;
      onChange: (nextValue: string) => void;
    }) => (
      <Input
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => {
          focusController.elementRef.current = event.currentTarget;
          focusController.onChangeRef.current = onChange;
          focusController.onFieldFocused();
        }}
      />
    ),
  };
}

function createFocusTrackedTextareaField(
  focusController: MergeTagFocusController,
) {
  return {
    type: "custom" as const,
    render: ({
      value,
      onChange,
    }: {
      value?: string;
      onChange: (nextValue: string) => void;
    }) => (
      <Textarea
        rows={4}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => {
          focusController.elementRef.current = event.currentTarget;
          focusController.onChangeRef.current = onChange;
          focusController.onFieldFocused();
        }}
      />
    ),
  };
}

// Synthetic "field" with no editable control at all — a static note bound
// to a throwaway prop key (design §4's shared technique).
function createNoteField(text: string) {
  return {
    type: "custom" as const,
    label: "",
    render: () => <EmailBlockFieldNote>{text}</EmailBlockFieldNote>,
  };
}

export function createEmailPuckConfig({
  focusController,
}: CreateEmailPuckConfigOptions): Config {
  // No assets/live data injected — the canvas never receives real
  // registration/pricing/countdown data (it's explicitly approximate, design
  // §3.3); every block falls back to its own empty/default state, matching
  // what an organizer sees before any real event data is wired in.
  const webConfig = createEventPagePuckConfig();

  const text = () => createFocusTrackedTextField(focusController);
  const textarea = () => createFocusTrackedTextareaField(focusController);

  const hero = webConfig.components.Hero;
  const highlights = webConfig.components.Highlights;
  const story = webConfig.components.Story;
  const schedule = webConfig.components.Schedule;
  const faq = webConfig.components.Faq;
  const registrationEmbed = webConfig.components.RegistrationEmbed;
  const ticketPricingTable = webConfig.components.TicketPricingTable;
  const countdownTimer = webConfig.components.CountdownTimer;

  return {
    // Single group (design §3.5) — 8 items is short enough that a
    // Content/Registration split (the web builder's grouping) would add a
    // click without adding scannability.
    categories: {
      email: {
        title: "Email blocks",
        components: [...EMAIL_SAFE_BLOCK_TYPES],
      },
    },
    components: {
      Hero: {
        // Note attaches right after secondaryCtaLabel (design §4 table),
        // not as the strictly-last field — imageUrl stays last, matching
        // the web block's own field order.
        fields: {
          eyebrow: text(),
          heading: textarea(),
          body: textarea(),
          primaryCtaLabel: text(),
          secondaryCtaLabel: text(),
          __emailNote: createNoteField(
            "Not shown in the email — see the canvas note above for why.",
          ),
          imageUrl: hero.fields!.imageUrl!,
        },
        defaultProps: { ...hero.defaultProps },
        render: hero.render,
      },
      Highlights: {
        // No divergence note (design §4 table) — stacking vertically
        // instead of a 3-column grid doesn't change what's typed.
        fields: {
          title: text(),
          intro: textarea(),
          itemOneTitle: text(),
          itemOneBody: textarea(),
          itemTwoTitle: text(),
          itemTwoBody: textarea(),
          itemThreeTitle: text(),
          itemThreeBody: textarea(),
        },
        // The web builder's `Highlights` component config has NO
        // `defaultProps` entry at all — every one of these keys is
        // REQUIRED (non-optional string) by the server write-time schema
        // (emailHighlightsBlockPropsSchema), so a freshly-dropped block
        // must start with every field already a defined "", never
        // `undefined`/absent, or an organizer who saves without touching
        // every single field gets a write-time validation rejection.
        defaultProps: {
          title: "",
          intro: "",
          itemOneTitle: "",
          itemOneBody: "",
          itemTwoTitle: "",
          itemTwoBody: "",
          itemThreeTitle: "",
          itemThreeBody: "",
          ...highlights.defaultProps,
        },
        render: highlights.render,
      },
      Story: {
        fields: {
          title: text(),
          body: textarea(),
          imageUrl: story.fields!.imageUrl!,
          imageSide: story.fields!.imageSide!,
          __emailNote: createNoteField(
            "In email, this puts the image first or text first (single column) instead of side-by-side.",
          ),
        },
        // The web builder's Story defaultProps only sets `imageSide` —
        // title/body/imageUrl need explicit "" fallbacks for the same
        // write-schema-completeness reason as Highlights above.
        defaultProps: {
          title: "",
          body: "",
          imageUrl: "",
          imageSide: "right",
          ...story.defaultProps,
        },
        render: story.render,
      },
      Schedule: {
        // No divergence note — already a single static text block on the
        // web, no behavior changes.
        fields: {
          title: text(),
          agenda: textarea(),
        },
        // No defaultProps in the web config — see the Highlights comment
        // above for why every key needs an explicit "" here.
        defaultProps: {
          title: "",
          agenda: "",
          ...schedule.defaultProps,
        },
        render: schedule.render,
      },
      Faq: {
        // No divergence note — already fully expanded (no accordion) on
        // the web, no behavior changes.
        fields: {
          title: text(),
          questionOne: text(),
          answerOne: textarea(),
          questionTwo: text(),
          answerTwo: textarea(),
          questionThree: text(),
          answerThree: textarea(),
        },
        // No defaultProps in the web config — see the Highlights comment
        // above for why every key needs an explicit "" here.
        defaultProps: {
          title: "",
          questionOne: "",
          answerOne: "",
          questionTwo: "",
          answerTwo: "",
          questionThree: "",
          answerThree: "",
          ...faq.defaultProps,
        },
        render: faq.render,
      },
      RegistrationEmbed: {
        label: registrationEmbed.label,
        fields: {
          title: text(),
          body: textarea(),
          buttonLabel: text(),
          __emailNote: createNoteField(
            "Renders as a real button when at least one registration path is active; otherwise shows a closed notice — never a broken form.",
          ),
        },
        defaultProps: { ...registrationEmbed.defaultProps },
        render: registrationEmbed.render,
      },
      TicketPricingTable: {
        label: ticketPricingTable.label,
        fields: {
          title: text(),
          intro: textarea(),
          emptyMessage: text(),
          __emailNote: createNoteField(
            "Prices shown reflect the moment this email is generated — not live at open time, unlike the website block of the same name.",
          ),
        },
        defaultProps: { ...ticketPricingTable.defaultProps },
        render: ticketPricingTable.render,
      },
      CountdownTimer: {
        label: countdownTimer.label,
        fields: {
          title: text(),
          target: countdownTimer.fields!.target!,
          customDateTime: countdownTimer.fields!.customDateTime!,
          completedMessage: text(),
          __emailNote: createNoteField(
            "Emails can't run a ticking countdown. This block renders a static date/time snapshot only — it won't update after the email is sent.",
          ),
        },
        defaultProps: { ...countdownTimer.defaultProps },
        render: countdownTimer.render,
      },
    },
  };
}
