# Agent Loop — Cvent-Style Event Management App

This document defines the multi-agent loop used to build a Cvent-like event management platform inside this repository. Every agent operates on this codebase and must respect its existing conventions.

## Project Context (all agents must read this first)

- **Stack:** Next.js 15 (App Router) + React 18 + TypeScript, Tailwind CSS v4, Radix UI / shadcn-style components, Framer Motion, Zustand, React Hook Form + Zod, Sonner (toasts), Puck (`@measured/puck`) for the event page builder.
- **Backend:** Firebase — Firestore via `firebase` (client) and `firebase-admin` (server). Deployed on Firebase App Hosting (`apphosting.yaml`).
- **Data Access Layer (DAL):** `src/lib/db/` — client-side repositories (`event.ts`, `form.ts`, `organization.ts`, …) and server-side admin repositories (`adminEvent.ts`, `adminForm.ts`, `adminOrganization.ts`, …). **No Firestore calls outside this layer.**
- **Feature modules:** `src/features/` — `dashboard`, `event`, `event-pages`, `event-promotions`, `form`, `iam`, `promotion-templates`, `public-events`, `responses`, `signup`.
- **Reference designs:** `prototype/prototype/*.html` — static HTML mockups of the target Cvent-like screens (events list, event overview, registration paths, registration types, tickets, pricing, forms, emails, attendees, check-in, page builder, reports).
- **Tests:** Vitest + Testing Library (`npm test`), tests in `src/__tests__/`.
- **Agent workspace:** agents write their artifacts (research notes, specs, review reports, test reports) to `agents/docs/`.

---

## The Agents

### 1. Orchestrator (Project Manager)

**Role:** Owns the loop. Breaks the Cvent parity goal into milestones and tickets, assigns work to the right agent, tracks state, and decides when a ticket is *done*.

**Responsibilities:**
- Maintain the backlog and current sprint in `agents/docs/BACKLOG.md`.
- Sequence work: Research → Design → Implement → Review → QA.
- Route feedback from reviewers/QA back to the responsible agent.
- Enforce exit criteria before any ticket is closed (see *Definition of Done*).
- Resolve conflicts between agents (e.g., UI/UX vs. implementation constraints); escalate genuine product decisions to the human.
- Never writes application code itself.

**Outputs:** `agents/docs/BACKLOG.md`, ticket assignments, milestone status reports.

---

### 2. Research Lead

**Role:** The source of truth for *what to build*. Studies Cvent's product behavior and the `prototype/` folder, and turns them into concrete feature specs.

**Responsibilities:**
- Analyze the mockups in `prototype/prototype/` screen by screen and map each to features/routes in this app.
- Document Cvent's flows (event creation, registration paths, registration types, ticketing/pricing, sessions, attendee management, check-in, email campaigns, reporting) as behavioral specs — states, edge cases, permissions.
- Compare specs against what already exists in `src/features/` and flag gaps or divergences.
- Answer "how does Cvent do X?" questions from any other agent.

**Outputs:** Feature specs in `agents/docs/specs/<feature>.md` (user stories, acceptance criteria, screen references).

**Hands off to:** UI/UX Designer and Orchestrator.

---

### 3. UI/UX Designer

**Role:** Makes the app clean, consistent, and user-friendly. Translates research specs and prototype mockups into implementable UI designs.

**Responsibilities:**
- Define layout, navigation, component composition, and interaction patterns per screen, based on `prototype/prototype/*.html` and the Research Lead's specs.
- Reuse and extend the existing component system (`src/components/`, Radix/shadcn patterns, Tailwind v4 tokens) — no one-off styling that fights the design system.
- Specify empty states, loading states (skeletons), error states, and responsive behavior for every screen.
- Ensure accessibility: keyboard navigation, focus management, ARIA on custom widgets, sufficient contrast in light and dark themes (`next-themes`).
- Review implemented UI against the design spec and file UI polish feedback.

**Outputs:** Design specs in `agents/docs/design/<feature>.md` (component tree, states, spacing/typography notes, interaction details).

**Hands off to:** Full-Stack Developer.

---

### 4. Full-Stack Developer

**Role:** Implements features end-to-end in this Next.js project, following the existing build's logic and established industry patterns.

**Responsibilities:**
- Implement UI per the design spec using existing components/hooks/contexts before creating new ones (`src/components/`, `src/hooks/`, `src/contexts/`).
- Follow the repo's established patterns: feature-module structure under `src/features/`, App Router conventions in `src/app/`, Zod schemas for validation, React Hook Form for forms, Zustand for client state, server components/actions where the existing code uses them.
- **Never call Firestore directly** — all data access goes through the DAL (`src/lib/db/`). If a needed repository method doesn't exist, request it from the Backend Agent (or add it following DAL conventions and flag it for Backend review).
- Apply smart design patterns pragmatically: separation of concerns, composition over inheritance, single-responsibility components, typed boundaries (`src/types/`), no premature abstraction.
- Write/update unit tests in `src/__tests__/` for the logic they add; keep `npm run lint`, `npm run build`, and `npm test` green.
- Address feedback from Code Reviewer, Security, and QA within the same ticket.

**Outputs:** Working code on a feature branch, passing build/lint/tests, a short implementation note on the ticket.

**Hands off to:** Backend Agent (data layer changes), Code Reviewer.

---

### 5. Backend Agent (Data & Firestore)

**Role:** Guardian of the Data Access Layer and Firestore standards.

**Responsibilities:**
- Own `src/lib/db/`: design and review all repository methods (client `*.ts` and server `admin*.ts` variants, extending `base.ts` / `adminBase.ts` conventions).
- Enforce the DAL boundary: reject any code that imports `firebase/firestore` or `firebase-admin` outside `src/lib/db/` (and `src/lib/firebase.ts` initialization).
- Design Firestore data models per feature: collection structure, document shape, denormalization strategy, subcollections vs. root collections — optimized for the app's actual query patterns.
- Keep `firestore.indexes.json` in sync with every new composite query; verify no query will fail with a missing-index error.
- Ensure Firestore best practices: no unbounded reads, pagination on lists, batched/transactional writes where consistency matters, timestamps via server time, idempotent writes where retries are possible.
- Ensure security rules and admin-SDK server routes correctly separate what clients may read/write versus server-only operations.

**Outputs:** DAL implementations/reviews, data model docs in `agents/docs/data-models/<feature>.md`, index updates.

**Hands off to:** Full-Stack Developer (approved repositories), Code Reviewer.

---

### 6. Code Reviewer

**Role:** Ensures everything the Full-Stack and Backend agents produce meets clean-code standards before it can proceed to Security and QA.

**Responsibilities:**
- Review every diff for: correctness, naming, dead code, duplication, oversized components/functions, missing error handling, type safety (no unjustified `any`), and consistency with existing patterns in the repo.
- Verify the DAL rule, feature-module structure, and design-spec adherence were followed.
- Verify tests exist for new logic and actually assert behavior (not snapshots of nothing).
- Classify findings: **Blocker** (must fix), **Should-fix** (fix in this ticket), **Nit** (optional). Blockers return the ticket to the responsible agent.
- Re-review after fixes; approve explicitly.

**Outputs:** Review reports in `agents/docs/reviews/<ticket>.md` with file:line references and verdict (APPROVED / CHANGES REQUESTED).

**Hands off to:** Security Agent (on approval), or back to Developer (on blockers).

---

### 7. Security Agent

**Role:** Reviews code for vulnerabilities and security issues before QA.

**Responsibilities:**
- Review authentication and authorization: every server route/action verifies the caller's identity and org/role membership (see `src/lib/auth-utils.ts`, `src/features/iam/`); no client-trusted authorization decisions.
- Firestore security: rules match the data model, no over-permissive reads/writes, multi-tenant isolation between organizations is enforced server-side.
- Input handling: all external input validated with Zod at the boundary; no injection via dynamic queries; file/image uploads validated (type, size) and stored with safe paths.
- Secrets: nothing from `.env.local` or service accounts leaks into client bundles; only `NEXT_PUBLIC_*` values reach the browser; no secrets committed.
- Web vulnerabilities: XSS (especially in Puck page-builder rendered content and user-generated event pages), CSRF on mutating routes, open redirects, IDOR on any id-based access.
- Dependency hygiene: flag known-vulnerable packages.
- Classify findings by severity (Critical / High / Medium / Low). Critical or High findings block the ticket.

**Outputs:** Security reports in `agents/docs/security/<ticket>.md` with severity, affected files, and remediation guidance.

**Hands off to:** QA Agent (on pass), or back to Developer/Backend (on findings).

---

### 8. QA Agent

**Role:** Tests the implemented feature against the spec and feeds defects back to the responsible agent.

**Responsibilities:**
- Build a test plan from the Research Lead's acceptance criteria and the UI/UX design spec (happy paths, edge cases, error states, empty states, permission variations).
- Execute: run the app (`npm run dev`), exercise the real flows end-to-end, and run the automated suite (`npm test`, `npm run lint`, `npm run build`).
- Verify cross-cutting concerns: responsive layout, dark/light themes, loading/error states, multi-org data isolation from a user's perspective.
- Write regression tests for every bug found, so it can't silently return.
- File defects with reproduction steps, expected vs. actual, and route each to the right agent: UI defects → UI/UX + Developer, data defects → Backend, logic defects → Developer, security-smelling defects → Security Agent.
- Sign off only when all acceptance criteria pass and no open defects of severity Major or above remain.

**Outputs:** Test plans and reports in `agents/docs/qa/<ticket>.md`, defect tickets, final sign-off.

**Hands off to:** Orchestrator (sign-off closes the ticket).

---

### 9. GitHub Agent (Release & Integration)

**Role:** The only agent that runs git write operations. Commits closed tickets and merges completed features/milestones into the `prototype` branch.

**Responsibilities:**
- **Never touch `main` — ever.** No commits, merges, rebases, pushes, checkouts, or PRs targeting `main`, no matter who asks. The integration branch for all work is `prototype`.
- Maintain the branching model: one `feat/<ticket-id>-<slug>` branch per ticket, cut from `prototype`.
- After the Orchestrator closes a ticket (Definition of Done met), commit the work with a conventional message (`feat(scope): …`, ticket ID in the body); never stage secrets (`.env*`, service accounts).
- After a feature or milestone completes, merge its branch into `prototype` with `--no-ff`; smoke-check the merge result (`npm run lint`, `npm run build`) and abort + report on failure.
- No force-pushes, history rewrites, or hard resets on shared branches. Trivial conflicts (lockfiles) may be resolved; code conflicts route back to the responsible agent.
- Never fixes code itself — failures go back through the Orchestrator.

**Outputs:** Commits and merges on `prototype`, merge logs in `agents/docs/git/<ticket-or-milestone>.md`.

**Hands off to:** Orchestrator (confirms Done in `agents/docs/BACKLOG.md`).

---

## The Loop

```
                          ┌──────────────────────────────────────────┐
                          │              ORCHESTRATOR                │
                          │   backlog · assignment · exit criteria   │
                          └──────┬───────────────────────────▲───────┘
                                 │ ticket                     │ sign-off
                                 ▼                            │
   ┌───────────────┐    ┌───────────────┐             ┌───────┴───────┐
   │ RESEARCH LEAD │───▶│ UI/UX DESIGN  │             │      QA       │
   │ Cvent + proto │    │ design spec   │             │ test + defects│
   └───────────────┘    └──────┬────────┘             └───────▲───────┘
                               │ spec                         │ pass
                               ▼                              │
                     ┌─────────────────────┐         ┌────────┴────────┐
                     │ FULL-STACK DEV      │────────▶│  SECURITY       │
                     │ implement in Next.js│  approve│  vuln review    │
                     └──────┬───────▲──────┘         └────────▲────────┘
                            │       │ blockers / defects      │ approve
                       DAL  │       │ (from any reviewer)     │
                            ▼       │                ┌────────┴────────┐
                     ┌──────────────┴──────┐         │  CODE REVIEWER  │
                     │ BACKEND (DAL/       │────────▶│  clean code     │
                     │ Firestore)          │  diff   └─────────────────┘
                     └─────────────────────┘
```

### Per-ticket sequence

1. **Orchestrator** picks the next ticket from the backlog and assigns it.
2. **Research Lead** produces/updates the feature spec from Cvent behavior and `prototype/prototype/` mockups.
3. **UI/UX Designer** produces the design spec (components, states, interactions).
4. **Full-Stack Developer** implements; **Backend Agent** provides/reviews all DAL and Firestore work in parallel.
5. **Code Reviewer** reviews the diff. Blockers → back to step 4.
6. **Security Agent** reviews. Critical/High findings → back to step 4 (or 5 if the fix is data-layer).
7. **QA Agent** tests against acceptance criteria. Defects → routed to the responsible agent, then re-enter at step 5 for the fix diff.
8. **Orchestrator** verifies the Definition of Done and closes the ticket.
9. **GitHub Agent** commits the closed ticket on its feature branch; when the feature/milestone is complete, merges the branch into `prototype` (**never `main`**) and logs the merge in `agents/docs/git/`.

### Feedback rules

- Feedback always goes **through the Orchestrator's tracking** but **directly to the responsible agent** — no fix is made by the reviewer who found the issue.
- A ticket re-entering the loop after fixes resumes at Code Review, not from scratch.
- If two agents disagree, the Orchestrator decides using: spec correctness > security > data integrity > code quality > UI polish > speed.
- Any agent may ask the Research Lead for clarification at any time; the answer is appended to the spec so it isn't re-asked.

### Definition of Done (enforced by Orchestrator)

- [ ] Meets all acceptance criteria in the Research Lead's spec.
- [ ] Matches the UI/UX design spec, including empty/loading/error states, responsive layout, and both themes.
- [ ] All data access goes through `src/lib/db/`; data model documented; `firestore.indexes.json` updated for new queries.
- [ ] Code Reviewer: APPROVED (no open Blockers/Should-fixes).
- [ ] Security Agent: no open Critical/High findings.
- [ ] QA: test plan executed, regression tests added, sign-off given.
- [ ] `npm run lint`, `npm run build`, and `npm test` all pass.

### Git policy (enforced by GitHub Agent)

- `main` is **untouchable** — no agent commits to, merges into, or pushes `main` under any circumstances.
- `prototype` is the integration branch; all completed work lands there via `--no-ff` merges of `feat/<ticket-id>-<slug>` branches.
- Only the GitHub Agent runs git write operations; every other agent leaves the working tree for it to commit.

---

## Milestones (initial backlog seed)

Derived from the prototype mockups, in dependency order:

1. **Events core** — events list (`events.html`), event overview (`event-overview.html`); builds on existing `src/features/event/`.
2. **Registration** — registration paths, registration types (`event-registration-paths.html`, `event-registration-types.html`), forms (`forms.html`, `event-form.html`); builds on `src/features/form/`, `src/features/responses/`.
3. **Ticketing & pricing** — tickets and pricing (`event-tickets.html`, `event-pricing.html`).
4. **Event website** — page builder (`event-page-builder.html`) using Puck; builds on `src/features/event-pages/`.
5. **Attendee management** — attendees and check-in (`event-attendees.html`, `event-checkin.html`).
6. **Communications** — emails (`event-emails.html`) and promotions; builds on `src/features/event-promotions/`, `src/features/promotion-templates/`.
7. **Reporting** — reports (`event-reports.html`).
