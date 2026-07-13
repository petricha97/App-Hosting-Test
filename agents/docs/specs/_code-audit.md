# Implementation Audit — Current Code State (2026-07-09)

Produced by the code-audit scout as gap-analysis input for the Cvent-parity backlog. Companion doc: `_screen-inventory.md` (prototype screens).

Note on structure: the real admin app lives under `src/app/dashboard/**`, not `src/app/events/`. `src/app/events/` is the **public** attendee-facing surface only. The `prototype/prototype/*.html` folder holds the target Cvent-like spec — most event sub-screens have **no** React/DAL counterpart yet.

## 1. Events core — EXISTS (solid)
- Admin list: `src/app/dashboard/events/page.tsx` → `src/features/dashboard/components/organization-events-browser.tsx`.
- Detail/overview: `src/app/dashboard/events/[eventId]/page.tsx` → `organization-event-detail.tsx` (rich: readiness checklist, identity, page-mode, promotions, form card).
- Create/edit: `src/app/dashboard/events/new/page.tsx` + `[eventId]/edit/page.tsx` → `src/features/event/create-event-workspace.tsx`; schema `src/features/event/schema.ts` (dates, periods, capacity, timezone, pageMode default/custom/redirect, registrationPeriod).
- Status toggle: `POST src/app/api/dashboard/events/[eventId]/status/route.ts`; CRUD `.../[eventId]/route.ts`.
- DAL: `src/lib/db/event.ts` + `adminEvent.ts`.
- **PARTIAL:** overview is a single page, not the multi-tab event workspace the prototype implies. `event-form-test.tsx` looks like a leftover test artifact.

## 2. Registration — PARTIAL (form-based only)
- Form builder feature exists: `src/features/form/` (`form-builder-workspace.tsx`, `schema.ts`, `default-fields.ts` — mandatory first/last/email), template system (`form-template-builder-workspace.tsx`, `event-form-template-chooser.tsx`, `template-linked-forms-manager.tsx`).
- Routes: `src/app/dashboard/events/[eventId]/form/page.tsx`, `src/app/dashboard/forms/**` (templates list/new/[templateId]).
- Public submit path: `POST src/app/api/events/[eventId]/register/route.ts` (validates against published form, writes FormData) and `.../dashboard/events/[eventId]/form/submit/route.ts`.
- Responses: `src/features/responses/` (`organization-responses-browser.tsx`, `utils.ts` derives attendeeName/email from submission), routes `src/app/dashboard/responses/page.tsx` + per-event `.../[eventId]/responses/page.tsx`.
- DAL: `form.ts`/`adminForm.ts`, `formData.ts`/`adminFormData.ts`, `formTemplate.ts`/`adminFormTemplate.ts`.
- **MISSING:** the prototype "registration **paths**" and "registration **types**" concepts (`event-registration-paths.html`, `event-registration-types.html`) do **not** exist anywhere in `src/`. Registration is a single flat form per event.

## 3. Ticketing & pricing — MISSING
- No tickets/pricing/inventory code in `src/`. The `Ticket` icon (`nav.ts`) and word "ticket" are cosmetic. `event-tickets.html` + `event-pricing.html` exist as spec only. `invoicePath` field on the event schema is an unused placeholder string. No paid-registration or order/payment logic.

## 4. Event website / page builder — EXISTS (Puck integrated)
- `src/features/event-pages/`: `puck.tsx` (config), `event-page-editor-workspace.tsx`, `event-pages-prototype.tsx`, `assets.ts`, `schema.ts`, `utils.ts`.
- Routes: `src/app/dashboard/events/[eventId]/page-builder/` (page + layout) and standalone `src/app/dashboard/prototypes/event-pages/`.
- APIs: `.../[eventId]/page/route.ts`, `page/publish/route.ts`, `page/assets/route.ts`.
- Public render: `src/features/public-events/components/public-custom-event-page.tsx` (Puck render) via `src/app/events/[eventId]/page.tsx`; event `pageMode` = default | custom | redirect.
- DAL: `eventPage.ts` + `adminEventPage.ts`. Uses `@measured/puck`. Mature area.

## 5. Attendee management & check-in — MISSING
- No attendee roster or check-in code in `src/`. "Attendee" appears only as a derived display label in `responses/utils.ts`. `event-attendees.html` + `event-checkin.html` are spec-only. No badges, QR, session tracking, or on-site tooling.

## 6. Communications / email — MISSING (promotions ≠ email)
- `src/features/event-promotions/` and `src/features/promotion-templates/` are **discount-code** engines, NOT email/communications. `event-promotions/types.ts` = discountType/discountValue/conditions/promoCode/inheritFromParent. Routes: `src/app/dashboard/promotions/**`, APIs `.../events/[eventId]/promotions/**` and `.../promotions/templates/**` (apply / apply-to-events / eligible-events). DAL: `promotionTemplate.ts`/`adminPromotionTemplate.ts`, `adminEventPromotion.ts` (no client `eventPromotion.ts`). This area is well-built.
- **No email sending anywhere** — no nodemailer/sendgrid/resend/react-email. `event-emails.html` (campaigns/invitations/reminders) has zero implementation.

## 7. Reporting & analytics — MISSING
- No reports/analytics/charts code. Dashboard overview (`src/app/dashboard/page.tsx`, `dashboard-shell.tsx`) shows summary cards driven partly by `src/features/dashboard/mock-data.ts`. `event-reports.html` unimplemented.

## 8. Cross-cutting
- **IAM — PARTIAL/STUB:** `src/features/iam/components/iam-dashboard.tsx` renders **hardcoded mock** members/invites/roles; only real code is `org-logo-upload.tsx` / `user-avatar-upload.tsx`. Route `src/app/dashboard/iam/page.tsx`. No real orgs/roles/permissions engine — but org membership exists via DAL `organization.ts`/`adminOrganization.ts`, `user.ts`/`adminUser.ts`, `user-organization.ts` (no admin variant) and `src/components/auth/join-organization-dialog.tsx`.
- **Dashboard — EXISTS:** shell/nav in `src/features/dashboard/` (`dashboard-shell.tsx`, `nav.ts`). Sidebar = Overview, Events, Forms, Responses, Promotions, Users&Access, Settings. `get-dashboard-scope.ts` resolves active org. Settings route: `src/app/dashboard/settings/page.tsx` + profile/org logo APIs.
- **Public-events — EXISTS:** `public-events-index.tsx`, `public-event-detail.tsx`, `public-custom-event-page.tsx`; routes `src/app/events/page.tsx` + `[eventId]/page.tsx`.
- **Signup — EXISTS:** `src/features/signup/` (credentials/organization/complete forms, `schema.ts`, `store.ts`); routes `src/app/(auth)/signup/**` + login; session API `src/app/api/auth/session/route.ts`.
- **DAL inventory (`src/lib/db/`):** base/adminBase/db; event, form, formData, formTemplate, organization, promotionTemplate, eventPage, user, user-organization + admin variants for each — **except**: `user-organization` has no admin variant, and `eventPromotion` exists only as `adminEventPromotion.ts` (no client repo). No repos for tickets/pricing/attendee/checkin/email/report.
- **API routes:** all real business routes namespaced under `src/app/api/dashboard/**` (events, forms, promotions, settings) plus public `api/events/[eventId]/register`, `api/auth/session`. Leftover scaffolding: `api/chat/route.ts`, `api/todos/route.ts` (+ `src/app/todo/page.tsx`) — starter-template cruft.
- **Tests — MINIMAL:** only `src/__tests__/domain-utils.test.ts`. No coverage for API routes, DAL, promotions, forms, or page-builder.
- **firestore.indexes.json — THIN:** only `EventPromotion` collection-group indexes + one field override. No indexes for events/forms/formData/responses queries — likely a scaling gap.

## Navigation summary
Sidebar (`nav.ts`): Overview · Events · Forms · Responses · Promotions · Users&Access · Settings. Routes under `src/app/dashboard/events/[eventId]/`: `page.tsx` (overview), `edit/`, `form/`, `responses/`, `page-builder/`. Missing vs prototype: tickets, pricing, registration-paths, registration-types, attendees, check-in, emails, reports tabs.

## Bottom line
Strong: event CRUD, form/template builder, responses, Puck page-builder, discount-promotions, auth/signup, public event pages. Stubbed: IAM (mock data), dashboard metrics (partial mock). Entirely missing (spec-only in `prototype/`): ticketing, pricing/payments, registration paths & types, attendee roster, check-in, email communications, reporting/analytics.
