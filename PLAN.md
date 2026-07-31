# Signup Wizard — Complete Rebuild (Cosden Style)
> Status: AWAITING APPROVAL — no code changes made yet.

---

## What the reference teaches

The Cosden Solutions multi-step form pattern has three principles:

1. **Each step is its own route** — `/signup/credentials`, `/signup/organization`, `/signup/complete`. No orchestrator.
2. **One shared store** — Zustand holds accumulated data. Steps read from it and write to it. No props, no context, no callbacks.
3. **Each step component is a small, self-contained function** — ~50-80 lines. It picks its own sub-schema from the master schema, validates, saves to the store, and navigates.

---

## Diagnosis: why the current wizard is messy

- `signup-wizard.tsx` is an orchestrator that manages step state, calls callbacks, owns all the Firebase logic, and conditionally renders steps — it does six jobs.
- `wizard-context.tsx` was added to reduce prop drilling but adds a second state layer on top of `useState` inside the wizard.
- Steps are told what to do via callbacks (`onComplete`, `onBack`). They can't act independently.

The fix is not to improve the orchestrator — it's to delete it.

---

## New file structure

```
src/
├── app/
│   └── (auth)/
│       └── signup/
│           ├── page.tsx                  ← keep; just redirects to /signup/credentials
│           ├── credentials/
│           │   └── page.tsx              ← NEW: thin wrapper
│           ├── organization/
│           │   └── page.tsx              ← NEW: thin wrapper
│           └── complete/
│               └── page.tsx              ← NEW: thin wrapper
│
└── features/
    └── signup/                           ← NEW top-level feature folder
        ├── schema.ts                     ← single Zod schema; .pick() per step
        ├── store.ts                      ← Zustand store: setData() + reset()
        └── components/
            ├── credentials-form.tsx      ← Step 1 (~70 lines)
            ├── organization-form.tsx     ← Step 2 (~100 lines, does Firebase)
            └── complete-form.tsx         ← Step 3 (~40 lines, success screen)
```

**New dependency**: `zustand` (the reference's state library — tiny, no boilerplate).

---

## Files to delete

| File | Why |
|---|---|
| `src/components/auth/signup-wizard.tsx` | Replaced by store + individual step components |
| `src/components/auth/wizard-context.tsx` | Replaced by Zustand store |
| `src/components/auth/steps/credentials-step.tsx` | Replaced by `credentials-form.tsx` |
| `src/components/auth/steps/organization-step.tsx` | Replaced by `organization-form.tsx` |
| `src/components/auth/steps/verification-step.tsx` | Was a mock; removed (sendEmailVerification still happens in org step) |
| `src/components/auth/steps/complete-step.tsx` | Replaced by `complete-form.tsx` |

**Not touched**: `db.ts`, `AuthContext.tsx`, `validation.ts`, `join-organization-dialog.tsx`, all other pages.

---

## Schema (`src/features/signup/schema.ts`)

One object, all fields. Steps use `.pick()` — no duplication.

```ts
export const signupSchema = z.object({
  // Step 1
  name: z.string().trim().max(80).optional(),
  email: z.email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters.")
    .regex(/[A-Za-z]/, "Include at least one letter.")
    .regex(/[0-9]/, "Include at least one number."),
  confirmPassword: z.string(),
  // Step 2
  action: z.enum(["create", "join", "auto-join"]),
  organizationName: z.string().trim().min(2).max(100).optional(),
  inviteCode: z.string().optional(),
  existingOrgId: z.string().optional(),
}).refine(v => v.password === v.confirmPassword, {
  path: ["confirmPassword"], message: "Passwords do not match.",
})

export const credentialsSchema = signupSchema.pick({
  name: true, email: true, password: true, confirmPassword: true,
})
export type CredentialsValues = z.infer<typeof credentialsSchema>

export const organizationSchema = signupSchema.pick({
  action: true, organizationName: true, inviteCode: true, existingOrgId: true,
})
export type OrganizationValues = z.infer<typeof organizationSchema>
```

---

## Store (`src/features/signup/store.ts`)

```ts
type SignupStore = {
  // Accumulated form data
  name?: string
  email?: string
  password?: string
  authMethod: "email" | "google"
  action?: "create" | "join" | "auto-join"
  organizationName?: string
  inviteCode?: string
  existingOrgId?: string
  // URL params from initial load
  prefilledCode?: string
  // Mutations
  setData: (data: Partial<Omit<SignupStore, "setData" | "reset">>) => void
  reset: () => void
}

export const useSignupStore = create<SignupStore>((set) => ({
  authMethod: "email",
  setData: (data) => set(data),
  reset: () => set({ authMethod: "email", name: undefined, email: undefined, ... }),
}))
```

No `persist` middleware — if user refreshes, they restart from step 1. This is correct behavior for a signup flow (and avoids storing passwords anywhere).

---

## Step 1 — `credentials-form.tsx` (~70 lines)

```
Reads from store: name, email, prefilledCode
Validates: credentialsSchema
On submit (email): setData({ ...values, authMethod: "email" }) → push("/signup/organization")
On Google sign-in: signInWithPopup → setData({ email, authMethod: "google" }) → push("/signup/organization")
Guard: none (it's the first step)
```

---

## Step 2 — `organization-form.tsx` (~100 lines)

```
Reads from store: email, authMethod, prefilledCode
Validates: organizationSchema
Guard: if no email → router.push("/signup/credentials")
On submit:
  1. If authMethod === "email": createUserWithEmailAndPassword + updateProfile + sendEmailVerification
  2. If action === "join" / "auto-join": signupJoinOrg(firebaseUser, name, orgId, joinMethod)
  3. If action === "create": signupCreateOrgAndUser(firebaseUser, name, orgName, domain, isPersonal)
  4. router.push("/signup/complete")
Shows: loading/error state inline
```

Firebase work is all in this one `onSubmit` function. No callbacks. No parent.

---

## Step 3 — `complete-form.tsx` (~40 lines)

```
Reads from store: name, organizationName, action (to say "joined" vs "created")
Guard: if no action → router.push("/signup/credentials")
Renders: success card + "Go to dashboard" button
On button click: store.reset() → router.push("/dashboard")
```

---

## Route pages (all thin wrappers)

```ts
// src/app/(auth)/signup/credentials/page.tsx
import { CredentialsForm } from "@/features/signup/components/credentials-form"
export default function CredentialsPage() { return <CredentialsForm /> }

// src/app/(auth)/signup/organization/page.tsx
import { OrganizationForm } from "@/features/signup/components/organization-form"
export default function OrganizationPage() { return <OrganizationForm /> }

// src/app/(auth)/signup/complete/page.tsx
import { CompleteForm } from "@/features/signup/components/complete-form"
export default function CompletePage() { return <CompleteForm /> }
```

---

## Updated `/signup/page.tsx`

Reads URL params (`?code=xxx`), stores them in the Zustand store, and redirects:

```ts
// src/app/(auth)/signup/page.tsx  — stays server component
import { redirect } from "next/navigation"

export default async function SignupPage({ searchParams }) {
  const { code, token } = await searchParams
  const q = code ? `?code=${code}` : ""
  redirect(`/signup/credentials${q}`)
}
```

The credentials form reads `?code` from `useSearchParams()` and calls `setData({ prefilledCode: code })` on mount.

---

## Implementation phases

### Phase 0 — Install Zustand
```bash
npm install zustand
```

### Phase 1 — Create feature folder + schema + store
- Create `src/features/signup/schema.ts`
- Create `src/features/signup/store.ts`
- **Checkpoint**: TypeScript compiles with no new errors.

### Phase 2 — Create step components
- Create `credentials-form.tsx` (Step 1)
- Create `organization-form.tsx` (Step 2, with Firebase)
- Create `complete-form.tsx` (Step 3)
- **Checkpoint**: Each file has no TS errors; form renders in browser.

### Phase 3 — Create route pages
- Create `credentials/page.tsx`, `organization/page.tsx`, `complete/page.tsx`
- Update `/signup/page.tsx` to redirect
- **Checkpoint**: Navigate to `/signup` → redirects to `/signup/credentials` → form loads.

### Phase 4 — Delete old files
- Delete `signup-wizard.tsx`, `wizard-context.tsx`, all step files in `auth/steps/`
- **Checkpoint**: `npm run build` exits 0.

---

## Acceptance criteria

- [ ] `src/features/signup/` is the only place signup form logic lives
- [ ] `signup-wizard.tsx` and `wizard-context.tsx` are deleted
- [ ] Each step component is under 100 lines
- [ ] No step imports from another step
- [ ] No props passed between steps (state only via store)
- [ ] `db.ts` is the only file that calls Firestore
- [ ] `npm run build` exits 0

---

**WAITING FOR CONFIRMATION** — reply "proceed" to begin implementation, or suggest changes.
