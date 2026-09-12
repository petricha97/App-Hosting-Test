# Claude orchestration rules

## Codex handoffs

- Route Codex work through the installed `openai/codex-plugin-cc` companion as documented in `HANDOVER.md`.
- Every new Codex task, rescue, review, or other handoff must explicitly pass `--model gpt-5.6-sol` to `codex-companion.mjs`. Do not rely on the Codex or plugin default model.
- Keep `--model gpt-5.6-sol` as a runtime argument; do not place it only inside the natural-language task prompt.
- After dispatch, query the job status and verify that `job.request.model` equals `gpt-5.6-sol`. If it is `null` or another model, do not claim the Sol requirement is satisfied; correct the dispatch before relying on its output.
- Leave reasoning effort unset unless the user explicitly requests a particular effort.
- This rule applies to all loop roles and all future tasks delegated from Claude to Codex.

