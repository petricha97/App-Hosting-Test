# SSR And Client Usage Review

Date: August 10, 2026

## Snapshot

- The app is SSR-first at the route boundary.
- `src/app` has `41` `page.tsx` files and `9` `layout.tsx` files.
- None of those pages or layouts are marked with `"use client"`.
- The repo currently has `143` TSX files marked with `"use client"`.
- The biggest first-load dashboard routes in the latest production build are:
  - `/dashboard/events/[eventId]/emails` - `337 kB`
  - `/dashboard/events/[eventId]/page-builder` - `312 kB`
  - `/dashboard/events/[eventId]/edit` - `300 kB`
  - `/login` - `296 kB`
  - `/events/[eventId]` - `271 kB`

## What Is Working Well

- Auth and organization access are enforced on the server through `requireSessionUser()` and `getDashboardScope()`.
- Dashboard and event routes fetch their initial data on the server before rendering.
- The event workspace layout already uses `Suspense`, so its shell can stream before the event record finishes loading.
- Public registration entry logic is server-driven before it hands off to the interactive stepper.

## Main Findings

### 1. Root layout is paying a global client cost

`src/app/layout.tsx` wraps the whole app with `AuthProvider` and `SiteHeader`.

That means public pages, auth pages, and dashboard pages all hydrate:

- Firebase client auth listeners
- Firestore-backed auth context state
- pathname-driven header logic

This is the biggest global SSR/client boundary issue in the repo.

### 2. Dashboard and event shells are too client-heavy

`DashboardShell` and `EventShell` are both client components that own:

- layout chrome
- breadcrumbs
- mobile drawer state
- sidebar collapse state
- logout wiring
- active-nav behavior

A lot of that can stay server-rendered, with only small client islands for browser-only behavior.

### 3. Several server pages hand off the whole screen to one large client workspace

This pattern shows up in multiple places:

- dashboard overview
- dashboard events list
- attendees workspace
- emails workspace
- page builder

The server fetch is correct, but the UI often becomes a large hydrated island immediately after that.

### 4. Public custom event pages are heavier than they should be

`PublicCustomEventPage` is a client component and pulls in the Puck runtime to render published event pages.

That likely contributes heavily to the `271 kB` first-load JS for `/events/[eventId]`, which is expensive for a public attendee-facing page.

### 5. Some client-heavy areas are justified

Not all client usage is bad.

The public registration stepper is a good example of justified client logic because it owns:

- draft resume/hydration
- step transitions
- quote refreshes
- payment flow state
- finalize/retry behavior

This is better optimized with code-splitting than by forcing it into a server-first shape.

### 6. Lazy loading opportunities are still open

I did not find active use of `next/dynamic` for the heavy editors and workspaces.

That means there is still room for bundle reduction without a deep architecture rewrite.

## Prioritized Improvement List

### Highest impact

1. Split the root layout so public routes do not always mount `AuthProvider`.
   Solution: Move `AuthProvider` into dashboard and auth-specific route group layouts, and keep the default public layout server-first.
   Code impact: High

2. Make the public header as server-driven as possible, and keep client auth/logout logic in a smaller island.
   Solution: Render the static header frame on the server and isolate only the auth-aware controls into a small client component.
   Code impact: Medium

3. Refactor `DashboardShell` into a server shell plus tiny client controls for sidebar, mobile nav, and account actions.
   Solution: Keep the frame, nav markup, and breadcrumb structure server-rendered, then hydrate only the collapse toggle, drawer toggle, and user actions.
   Code impact: High

4. Refactor `EventShell` the same way.
   Solution: Mirror the `DashboardShell` split by keeping event chrome on the server and moving only localStorage, drawer, and route-reactive controls into client islands.
   Code impact: High

### High value next

5. Break read-mostly workspace screens into mixed trees instead of one large top-level client workspace.
   Solution: Let server pages render the initial table/card content and keep only filters, tabs, dialogs, and row actions interactive.
   Code impact: High

6. Keep tables, cards, summaries, and static framing on the server when they do not need browser state.
   Solution: Pull passive presentation components out of client workspaces and pass them serialized data from the server page.
   Code impact: Medium

7. Restrict client components to search, tabs, dialogs, inline mutations, and similar interactive controls.
   Solution: Treat client components as leaf controls instead of screen-level containers whenever the UI does not depend on browser-only state.
   Code impact: Medium

### Bundle and performance wins

8. Lazy-load the email editor and block designer.
   Solution: Use `next/dynamic` for the editor surface and load the block designer only when the user opens or switches into it.
   Code impact: Medium

9. Lazy-load the page builder and other heavy editor tooling.
   Solution: Split editor-only libraries and load them after route mount or only when editing mode is entered.
   Code impact: Medium

10. Lazy-load scanner/reporting tools that are not needed on first paint.
    Solution: Delay importing scan/report modules until the user opens those views or activates the relevant tool panel.
    Code impact: Medium

11. Audit dialog-heavy screens so modal content does not ship until opened.
    Solution: Replace always-mounted modal trees with on-demand imports or conditional rendering behind open state.
    Code impact: Low

### Public route improvements

12. Replace the public Puck runtime with a lighter read-only renderer for published event pages if possible.
    Solution: Introduce a published-page renderer that consumes stored content without bringing in the full editor/runtime stack.
    Code impact: High

13. Pre-render or server-render published page output where interactive editing is not needed.
    Solution: Render published event page content on the server and reserve client hydration only for blocks that truly require browser interactivity.
    Code impact: High

14. Review the public event detail page bundle for components that do not need to hydrate for attendees.
    Solution: Audit attendee-facing components one by one and move passive content back to the server where possible.
    Code impact: Low

### Architecture cleanup

15. Reduce duplicate auth sources where possible between server session gating and client auth context state.
    Solution: Choose a clearer ownership model so server session data drives SSR and client auth is used only where live browser state is actually needed.
    Code impact: High

16. Review places where Firestore subscriptions are useful versus places where server refresh is enough.
    Solution: Keep subscriptions only for genuinely live surfaces and replace passive listeners with server reloads or explicit refresh actions.
    Code impact: Medium

17. Consider server actions for simple dashboard mutations that currently need extra client fetch plumbing.
    Solution: Use server actions for straightforward form submissions and simple mutations where they reduce API boilerplate and client orchestration.
    Code impact: Medium

## Suggested Order Of Work

1. Move auth/provider responsibility out of the global root layout.
2. Shrink `DashboardShell` and `EventShell`.
3. Lazy-load the email editor and page builder.
4. Rework public custom event page rendering so attendee pages ship less JS.
5. Then review each workspace screen one by one for server/client boundary trimming.

## Best First Targets

- `src/app/layout.tsx`
- `src/contexts/AuthContext.tsx`
- `src/components/layout/site-header.tsx`
- `src/features/dashboard/components/dashboard-shell.tsx`
- `src/features/event/components/event-shell.tsx`
- `src/features/public-events/components/public-custom-event-page.tsx`
- `src/features/emails/components/emails-workspace.tsx`
- `src/features/event-pages/components/event-page-editor-workspace.tsx`

## Notes

- This is not a case where the app is “doing SSR wrong”.
- The bigger issue is that several strong server entrypoints immediately hand off to large client-side UI surfaces.
- The best improvements here are boundary trimming, provider scoping, and targeted lazy loading.
