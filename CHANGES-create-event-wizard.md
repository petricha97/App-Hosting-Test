# Create-Event Wizard — Change Summary

**Branch:** `prototype-v2` · **Status:** in working tree, **not committed**, `main` untouched
**Date:** 2026-08-09

Converts the long single-scrolling **create-event** page into a **5-step wizard** matching the
approved prototype. **Editing an existing event is unchanged** (still the single-page form).

---

## How to look at it yourself

```bash
# see everything changed / added
git status --short

# the two modified files (pure refactor + one render swap)
git diff src/features/event/create-event-workspace.tsx
git diff "src/app/dashboard/(workspace)/events/new/page.tsx"

# run it
npm run dev        # then open /dashboard/events/new  (wizard)
                   #        /dashboard/events/<id>/edit (unchanged single page)

# checks
npm run lint                       # clean
npx vitest run src/__tests__/create-event-wizard.test.tsx   # 5/5 pass
```

---

## Files created

| File | Purpose |
|------|---------|
| `src/features/event/event-form-core.ts` | Shared, side-effect-free core extracted from the old workspace: form defaults (`buildWorkspaceDefaults`), helpers (`normalizeScheduleRange`, `buildOrganizationPath`, `PENDING_FORM_PATH`, `EMPTY_SCHEDULE_RANGE`), shared types, and **`submitEventForm(...)`** — the exact original submit logic (create + edit). One source of truth for both the wizard and the edit workspace. |
| `src/features/event/create-event-wizard.tsx` | The create-only wizard container: stepper + card shell + per-step validation + footer nav (Back / Save & exit as draft / Next-or-Submit) + submit. |
| `src/features/event/wizard/steps.ts` | Step metadata (labels, copy, `optional` flags) and `getStepFields()` — the per-step field list used for validation. |
| `src/features/event/wizard/wizard-stepper.tsx` | Horizontal stepper: done / current / upcoming / error states; visited steps are clickable to jump back. |
| `src/features/event/wizard/step-basics.tsx` | Step 1 — name, description, capacity, expected guests. |
| `src/features/event/wizard/step-schedule.tsx` | Step 2 — registration window + **multi-range `periods` field array (Add/Remove, min 1)** + timezone + allow-overlap. |
| `src/features/event/wizard/step-registration.tsx` | Step 3 (optional) — informational empty state; form is linked later. |
| `src/features/event/wizard/step-public-page.tsx` | Step 4 (optional) — page-mode radio cards + conditional redirect URL. |
| `src/features/event/wizard/step-review.tsx` | Step 5 — grouped read-only summary with per-section **Edit** jump + Draft/Publish radio. |
| `src/__tests__/create-event-wizard.test.tsx` | RTL/jsdom tests for the wizard (Firestore mocked). |

## Files modified

| File | Change |
|------|--------|
| `src/features/event/create-event-workspace.tsx` | **Refactor only, no behavior change.** Removed its local copies of the helpers/types and now imports them from `event-form-core`; `onSubmit` delegates to `submitEventForm(...)`. Everything else in the diff is Prettier line-wrapping. The edit UI/JSX is unchanged. |
| `src/app/dashboard/(workspace)/events/new/page.tsx` | Renders `<CreateEventWizard />` instead of `<CreateEventWorkspace />`. |

---

## The 5 steps (matches the approved prototype)

1. **Event details** *(required)* — name, description, capacity, expected guests
2. **Date & time** *(required)* — event date ranges (multi-range), timezone, allow-overlap, registration window
3. **Registration form** *(optional)* — informational; the form is created/linked later from the event's Forms area
4. **Public page** *(optional)* — default / custom / redirect (redirect URL required only if "redirect" is chosen)
5. **Review & publish** — summary with Edit-jump-back; Draft → button says **Submit**, Publish → **Publish event**

**Per-step validation:** "Next" runs `form.trigger([fields for that step])`; invalid input blocks advance,
flags the step red in the stepper, and focuses the first invalid field. Optional steps never block (except the
redirect-URL rule on step 4). On final submit, any remaining errors jump you back to the first offending step.

---

## What was intentionally NOT done (and why) — follow-ups

- **No "autosave / Draft saved" chip.** The prototype implied server-side draft persistence that doesn't exist.
  Faking it would mislead. The footer states plainly: *"Progress is kept while this page is open; it is not
  autosaved."* → *Follow-up:* real draft persistence if you want it.
- **Step 3 does not list or reuse existing forms.** The templates API is **POST-only** (no GET to list),
  so there's no way to fetch/select forms client-side yet. `formPath` stays the current system value `Form/pending`.
  → *Follow-up:* add `GET /api/dashboard/forms/templates` + wire selection to set a real `Form/<id>`.
- **`formPath = "Form/pending"`** — unchanged from today's behavior (the old page also stamped this).
- **Schema unchanged, no new API routes, no backend changes.**

---

## Verification (run independently by the orchestrator)

- `next lint` → **clean** (only the unrelated Next lockfile warning).
- `npx tsc --noEmit` → 9 errors, **all pre-existing in unrelated test files, 0 in the new code**
  (confirmed the same 9 exist with these changes stashed).
- New wizard test file → **5/5 pass**.
- Full suite → 2131 pass, **2 pre-existing failures** unrelated to this change
  (`m8-t4-backend-form-template-routes`, `m8-event-overview-qa-integration`) — **confirmed failing on the
  clean branch with this work stashed**, so not caused here.

## Known LOW item (non-blocking)

- On **Step 2**, if a schedule error is on a nested object (e.g. the schema's "end after start" refinement,
  which attaches to `registrationPeriod`/`periods`), the "focus first invalid field" jump may not land on a
  specific input (React Hook Form `setFocus` on an object/array path can be a no-op). The **error messages still
  display** under the affected fields — only the auto-focus is skipped. → *Follow-up:* focus the deepest invalid
  leaf path for nested schedule errors.

---

## Review verdict

Code reviewed file-by-file (the automated review agents hit the account session limit mid-run, so the orchestrator
performed the review directly): logic correct, edit-mode extraction behavior-preserving, styling consistent with the
app's existing dashboard (shadcn components, `rounded-[2rem]` cards, orange icon chips, slate text, dark-theme
aware), DRY via the shared core, files small and focused. No CRITICAL/HIGH/MEDIUM issues found; one LOW follow-up above.

---

## Follow-up refactor — shared field components (one source of truth per field)

**Why:** originally the field markup was duplicated — the create wizard had its own step JSX and the edit
workspace had its own inline JSX for the same fields, so a change in one could silently drift from the other.
This refactor extracts each field group into ONE component that **both** screens render.

### New files
| File | Purpose |
|------|---------|
| `src/features/event/fields/event-basics-fields.tsx` | Name, description, capacity, expected guests — the single definition, used by create Step 1 and the edit "Event basics" card. |
| `src/features/event/fields/event-schedule-fields.tsx` | Registration window + event date ranges (`periods` add/remove list) + timezone + allow-overlap. Owns the `useFieldArray`. Used by create Step 2 and the edit "Schedule and timing" card. Status is intentionally NOT here. |
| `src/features/event/fields/event-public-page-fields.tsx` | Page-mode radio cards + conditional redirect URL. Used by create Step 4 and inside the edit "Event basics" card. |

### Changed files
| File | Change |
|------|--------|
| `wizard/step-basics.tsx` / `step-schedule.tsx` / `step-public-page.tsx` | Now thin wrappers that render the shared field group (each ~18 lines). |
| `create-event-workspace.tsx` (EDIT) | Its inline field JSX replaced with `<EventBasicsFields>`, `<EventPublicPageFields>`, `<EventScheduleFields>`. Kept EDIT-only bits: the status `<select>`, the dev-only linkage-paths card, and the right-hand context panel. Removed now-unused imports (`useFieldArray`, `Plus`, `Trash2`, `Switch`, `Textarea`, `EMPTY_SCHEDULE_RANGE`). Added a header comment marking it the **EDIT** screen. |
| `create-event-wizard.tsx` (CREATE) | Added a header comment marking it the **CREATE** screen. No logic change. |

### Which is which (now labelled in-code)
- **CREATE** = `create-event-wizard.tsx` (rendered by `events/new/page.tsx`) — the 5-step wizard.
- **EDIT** = `create-event-workspace.tsx` (rendered by `events/[eventId]/edit/page.tsx` with `mode="edit"`) — the single-page form.
Each file now opens with a comment block stating its role and pointing at the shared field groups.

### Visual note (intended)
To get one source of truth, the **edit** screen now renders the wizard's nicer field versions — so its
public-page picker is now **radio cards** (was a plain `<select>`), the schedule headings/layout match create,
and the timezone sits on its own row with the status `<select>` beneath it. This makes create and edit
**consistent**. No fields were added or removed; the schema and saved data are unchanged.

### Verification (re-run after this refactor)
- `next lint` → clean.
- `npx tsc --noEmit` → 9 errors, **0 in the event feature** (same pre-existing 9).
- Full suite → **2131 passed, same 2 pre-existing failures** (unchanged from before the refactor).
- No commit; `main` untouched.
