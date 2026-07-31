import type { Locator } from "@playwright/test";

// DEFECT WORKAROUND (see agents/docs/qa/e2e-regression-m0-m1-m2.md, QA-2,
// Major): the "Base price" field in FeeDialog and the "Rate"/"Amount" fields
// in TaxDialog wrap their <Input> in an extra `<div className="relative">`
// (to position a currency-symbol/percent-sign affix) *between*
// `<FormControl>` and `<Input>`. FormControl is a Radix `Slot.Root` that
// forwards `id={formItemId}` onto its single direct child — here that child
// is the wrapper `<div>`, not the `<Input>`, so `id` lands on the div and
// `<FormLabel htmlFor={formItemId}>` never actually associates with the real
// input. The browser falls back to the input's `placeholder` for its
// accessible name (which happens to look like a plausible value, e.g.
// "750.00" or "8.875"), so `getByLabel("Base price")` never resolves and
// assistive tech announces the wrong name. Every sibling field in the same
// dialogs (Name, Ticket, Registration type, Currency, Type) is unaffected
// because their `<Input>`/`<SelectTrigger>` is FormControl's direct child.
//
// This helper scopes to the FormItem `data-slot` wrapper by its visible
// label text and grabs the nested real <input>, sidestepping the broken
// label-for association without touching application code.
export function getInputByFormItemLabel(scope: Locator, labelText: string): Locator {
  return scope
    .locator('[data-slot="form-item"]')
    .filter({ hasText: labelText })
    .locator("input");
}
