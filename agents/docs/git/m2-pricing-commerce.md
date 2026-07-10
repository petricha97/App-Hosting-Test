# Merge Log — M2 Pricing & Commerce

- **Date:** 2026-07-10
- **Feature branch:** `feat/m2-pricing-commerce`
- **Target branch:** `prototype`
- **Merge commit:** `9709b8a97902a426450a560c606f2c110368b42f`

## Commits included

- `86d3f75` — feat(m2): pricing & commerce — fees, discounts, taxes, order engine (M2-T1..T4)
  - 84 files changed, 12,215 insertions(+), 286 deletions(-)
  - Fees/taxes DALs + API routes + pricing workspace UI (fees, service fees, taxes, discounts tabs)
  - Discount/promotion settings route and eventPromotion / eventPromotionDefaults DALs
  - Order engine: adminOrder DAL with transactional order finalize, pricing-math, place-order, order-id
  - Payments: provider abstraction + simulated payment provider
  - Security hardening: firestore.rules introduced (client lockdown), server-side org membership
    verification (org-membership, caller-token, organizations lookup/join/switch), M1 routes
    upgraded to hardened route scope
  - Agent artifacts: agents/docs/{specs,design,data-models,reviews,security,qa}/m2-pricing-commerce.md
    and BACKLOG.md update

## Loop verdicts

- Code Reviewer: APPROVED (after B-1/B-2 fixes)
- Security: PASS (after Critical/High fixes — rules lockdown + server-side membership verification)
- QA: SIGNED OFF 44/44 ACs (`agents/docs/qa/m2-pricing-commerce.md`)

## Verification on merge result (prototype)

- `npm run lint` — PASS (no ESLint warnings or errors)
- `npm run build` — PASS (compiled successfully, 30/30 static pages generated)
- `npm test` — PASS (24 test files, 417/417 tests)

## Merge details

- Merge strategy: `git merge --no-ff` (ort), no conflicts
- No push performed (per instruction)
- Next branch cut: `feat/m3-registration-paths` from `prototype`
