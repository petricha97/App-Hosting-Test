# M9-T2 — Ticket UX design

Reference and acceptance criteria: `agents/docs/specs/m9-t2-ticket-ux.md`. Approved in-conversation mockup provides the composition; the production implementation uses the existing app design system and USD pricing contract.

- Keep the existing Dialog with a three-step progress indicator, scrollable content on small screens, Back/Continue footer, and Publish ticket as the final action.
- Ticket details: label the primary input Ticket name. Use an accessible Unlimited / Set quantity choice. Reveal numeric quantity only when limited. Use Schedule ticket sales to reveal the two date inputs; date help specifies event timezone. Advanced settings is a keyboard-operable disclosure containing Ticket code. Validation must expand any disclosure hiding the error.
- Audience & price: show selectable existing registration types with a price per selected type. Keep Add registration type visible. Inline creation has name and price first, code and audience-wide limit in Advanced settings. Adding a type selects it and retains its price. Pending creation prevents duplicate submissions and lost input; canceling a draft returns to audience selection.
- Empty event: offer General attendee, selected, with a price input. Creation happens only after an explicit continuation and uses the normal registration-type model. Request failure remains on this step with entered values intact.
- Review: show the actual ticket quantity, dates, audience prices, and any new audience-wide limits. Avoid a separate availability decision; publishing enables sales subject to date and capacity rules.
- Management: contextual Pause sales / Resume sales actions update only the ticket sales flag. Present status in plain language (Paused, Scheduled, Sales ended, Sold out, On sale) according to the actual limiting condition. Registration-type limits remain available in Advanced settings. Saved identifiers remain stable on rename.
- All new elements reuse Button, Input, Form, Dialog, Checkbox/Switch and existing table/menu primitives. Use foreground/background/border/muted tokens for both themes. Maintain real labels, visible error text, focus management, and wrap/stack form columns at small widths.

Verification: automated behavioral tests plus direct browser checks of the local app when its signed-in session is available. Do not publish a test ticket to live-backed data just to verify layout.
