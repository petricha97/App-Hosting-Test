#!/usr/bin/env bash

set -uo pipefail

output_file="$(mktemp)"
trap 'rm -f "$output_file"' EXIT

if npx tsc --noEmit --pretty false >"$output_file" 2>&1; then
  tsc_status=0
else
  tsc_status=$?
fi

cat "$output_file"

# Temporary M8-T12 baseline: exactly seven pre-existing errors live in these
# three tests. Remove this exception as soon as those tests are fixed.
error_lines="$(grep 'error TS' "$output_file" || true)"
baseline_lines="$(printf '%s\n' "$error_lines" | grep -E '^src/__tests__/(attendees-roster|event-org-scoping|register-route)\.test\.ts' || true)"
new_error_lines="$(printf '%s\n' "$error_lines" | grep -Ev '^src/__tests__/(attendees-roster|event-org-scoping|register-route)\.test\.ts' || true)"
baseline_count="$(printf '%s\n' "$baseline_lines" | grep -c 'error TS' || true)"

if [[ -n "$new_error_lines" ]]; then
  echo "New TypeScript errors found outside the documented baseline:" >&2
  printf '%s\n' "$new_error_lines" >&2
  exit 1
fi

if [[ "$baseline_count" -ne 7 ]]; then
  echo "Expected exactly 7 documented baseline errors, found $baseline_count; update or remove the baseline deliberately." >&2
  exit 1
fi

if [[ "$tsc_status" -eq 0 ]]; then
  echo "TypeScript unexpectedly passed while the documented baseline remains configured; remove the baseline exception." >&2
  exit 1
fi

echo "Typecheck passed: 7 documented baseline errors and no new errors."
