# Security Review — M4 Website Blocks (feat/m4-website-blocks, working tree)

Date: 2026-07-11
Reviewer: Security Agent
Verdict: **PASS** (no Critical/High findings; 1 Medium, 3 Low, 1 Info — see below)

Scope reviewed (uncommitted diff + new untracked files): the three new Puck blocks
(`src/features/event-pages/blocks/{ticket-pricing-table,countdown,registration-cta}.tsx`),
`src/features/event-pages/{puck.tsx,schema.ts,utils.ts,countdown.ts,registration-state.ts}`,
editor workspace + builder page, public event page + `src/features/public-events/server/path-page.ts`,
`src/features/public-registration/{pricing-projection.ts,server/tickets.ts,types.ts}`,
`src/lib/db/adminEventPage.ts`, path routes (`page`, `page/publish`, `registration-paths/[pathId]`),
`src/features/registration/utils.ts` (eventLocalDateTimeToUtcMs), `firestore.rules`, `npm audit`, new tests.

---

## Findings (most severe first)

### SEC-M4-1 — Medium: unpublished `draftContent` shipped to anonymous visitors in the public RSC payload
- **Affected:** `src/app/events/[eventId]/page.tsx` (custom-page branch, passes
  `serializeEventPage(publishedEventPage)`), `src/features/event-pages/utils.ts:4-17,39-69`
  (`SerializedEventPage` includes `draftContent`, `storagePrefix`, `organizationId`),
  `src/features/public-events/components/public-custom-event-page.tsx:21,74-79` (`"use client"`,
  receives the full serialized page; `data={publishedContent ?? draftContent}`).
- **Scenario:** `PublicCustomEventPage` is a client component, so every prop is serialized into the
  Flight/RSC payload. An anonymous visitor opens `/events/<id>` (or `/events/<id>?path=<pathId>`),
  views the page source / network stream, and reads the page's **unpublished draft revision** —
  e.g., an unannounced speaker, date change, or price typed into a Story/Hero block that the
  organizer saved but deliberately did not publish. M4 extends this pre-existing default-page
  exposure to every path page. `storagePrefix` (internal storage layout) also leaks.
- **Remediation (Backend/Developer):** on the public branch, pass a public projection instead of
  the full doc — `{ id, title, publishedContent }` only (mirror the exact-key discipline of
  `pricing-projection.ts`). Since `getAdminPublishedEventPageForEvent` already guarantees
  `publishedContent !== null`, the `?? draftContent` fallback in `public-custom-event-page.tsx`
  is dead code on the public path and should be removed with it. Non-blocking (org-authored
  marketing content, no credentials/PII, no privilege impact), but fix in M4 follow-up rather
  than letting it age.

### SEC-M4-2 — Low (carry-over): known-vulnerable dependencies (`next@15.0.5` et al.)
- **Affected:** `package.json` (unchanged by this ticket). `npm audit`: 23 vulns
  (2 critical, 5 high) — `next@15.0.5` (Server Actions DoS GHSA-7m27-7ghc-44w9, cache poisoning,
  image-optimization advisories; middleware auth-bypass GHSA-f82v-jwr5-mffw not directly reachable —
  repo still has no `middleware.ts`), `firebase-admin`→`grpc/protobufjs/uuid` chain, `form-data`,
  `undici`; `vitest`/`vite`/`esbuild` criticals are dev-only.
- **Remediation:** same as SEC-M0-2 (tracked since M0): upgrade Next to a patched 15.x, run
  `npm audit fix` for the transitive chain. Pre-existing, not M4-specific — does not block.

### SEC-M4-3 — Low: `eventId` interpolated unencoded into `registerHref`
- **Affected:** `src/app/events/[eventId]/page.tsx` (`registerHref = \`/events/${eventId}/register?...\``),
  same pattern in the editor config (`event-page-editor-workspace.tsx`).
- **Scenario:** not exploitable today — `eventId` must match an existing published event doc id
  (Firestore ids cannot contain `/`, and events are created via `.add()` auto-ids), and the path id
  side is already `encodeURIComponent`-wrapped. A `javascript:` scheme is impossible because the
  href always starts with the literal `/events/` prefix.
- **Remediation:** defense-in-depth: `encodeURIComponent(eventId)` for symmetry. Note-only.

### SEC-M4-4 — Low (informational): audience names and minimum prices of restricted tickets are public
- **Affected:** `src/features/public-registration/pricing-projection.ts:123-125`,
  `src/features/event-pages/blocks/ticket-pricing-table.tsx:60-64`.
- **Scenario:** the pricing table intentionally never hides rows for eligibility (spec AC-7), so
  registration-type names (e.g., internal labels like "Staff comp") and the minimum price of
  audience-restricted tickets render for every anonymous visitor. Spec-sanctioned; flagging so
  organizers/docs treat registration-type names as public-facing copy.
- **Remediation:** none required; consider a docs note that audience names appear on public pages.

### SEC-M4-5 — Info: public custom page read amplification (bounded)
- **Affected:** `src/app/events/[eventId]/page.tsx`.
- Every anonymous render of a custom page now performs ~6 Firestore lookups: event, form,
  path (doc get), page (`findWhere eventId`), pricing (tickets+fees+registrationTypes), paths list.
  All are single-event scoped and bounded (pages per event = paths + 1; no unbounded fan-out,
  no attacker-controlled query params reach queries beyond exact-match ids). Acceptable; consider
  request-level caching/`cache()` if traffic warrants. Countdown block cleans up its 1s interval
  on unmount (`countdown.tsx:66-70`) — no client-side leak.

---

## Verified controls (no findings)

- **XSS / Puck surface:** all org-configured props (titles, intro, body, buttonLabel,
  emptyMessage, completedMessage) and event/ticket/audience names render as React text; every
  block prop is coerced via `String(...)` in `puck.tsx` renders; zero `dangerouslySetInnerHTML`
  in `src/features/event-pages/`. No Puck prop ever reaches an `href` — `registerHref`/`pathsHref`
  are server/dashboard-constructed constants; the CTA "closed" state is a non-focusable `<span>`.
  `customDateTime` is only `Date.parse`d (`countdown.ts:26-32`) and re-rendered through
  `Intl.DateTimeFormat` — never echoed into markup/attributes. Editor hints are static strings and
  `editorHints` is never set by the public renderer (`public-custom-event-page.tsx`).
- **Pricing projection discipline:** `buildPublicPricingProjection` rebuilds rows with an exact
  key list — `name`, `code`, `soldOut` (boolean only), `audienceNames` (strings only),
  `prices{currency,minPriceMinor,isFrom}`. No ticket/fee/registrationTypeIds, no capacity or
  registeredCount, no sales timestamps can cross to the client. `listPublicTicketsForEvent`
  is a thin adapter and stays `server-only`.
- **Draft pages not publicly reachable:** `resolvePublicPathPage` requires an org+event-scoped
  **active** path AND `getAdminPublishedEventPageForEvent` (status === "published" &&
  publishedContent). Inactive/foreign/unknown/draft-only `?path=` degrades to the default
  behavior; unpublished events 404 before any page lookup. (Draft *content* of published docs —
  see SEC-M4-1.)
- **pageKey authZ:** `page` and `page/publish` routes enforce session + org + `write:events` +
  event ownership, then validate non-default `pageKey` via org/event-scoped
  `getAdminRegistrationPathForEvent` → foreign/unknown path id = 400. Builder `?path=` 404s on
  foreign ids (matched against this event's own path list). `"default"` cannot collide with a
  path id (paths are Firestore `.add()` auto-ids). Path-page publish never flips
  `event.pageMode`/`eventPagePath`.
- **Cascade scoping:** `deleteAdminEventPagesForPageKey` filters `eventId` → `organizationId` →
  `pageKey` before deleting; called with the route-scope org id, so it can never touch another
  event's or org's page.
- **firestore.rules:** `EventPage` remains `allow read, write: if false` (line 300);
  `RegistrationPath` deny-all. pageKey introduces no client SDK path; all access stays behind
  admin-SDK server code.
- **Input validation:** `saveEventPageDraftSchema.pageKey` trimmed, 1–128 chars, optional;
  page content through `eventPageContentSchema`; `eventLocalDateTimeToUtcMs` regex-validates
  date/time parts and returns null on malformed input.

## Verdict

**PASS** — proceed to QA. SEC-M4-1 (Medium) should be scheduled as an M4 follow-up;
SEC-M4-2 remains the standing dependency-upgrade ticket from M0.
