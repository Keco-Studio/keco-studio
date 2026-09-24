#!/usr/bin/env bash
set -euo pipefail

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required for the local database test gate." >&2
  exit 1
fi

supabase_args=()
if [[ -n "${SUPABASE_TEST_WORKDIR:-}" ]]; then
  if [[ ! -d "$SUPABASE_TEST_WORKDIR/supabase" ]]; then
    echo "SUPABASE_TEST_WORKDIR must contain a Supabase project." >&2
    exit 1
  fi
  supabase_args=(--workdir "$SUPABASE_TEST_WORKDIR")
fi

if ! local_status=$(supabase status "${supabase_args[@]}" -o env); then
  echo "A running local Supabase stack is required." >&2
  exit 1
fi
unset API_URL ANON_KEY SERVICE_ROLE_KEY DB_URL
eval "$local_status"

export NEXT_PUBLIC_SUPABASE_URL="${API_URL:-}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY:-}"
export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-}"

if [[ -z "$NEXT_PUBLIC_SUPABASE_ANON_KEY" || -z "$SUPABASE_SERVICE_ROLE_KEY" || -z "${DB_URL:-}" ]] \
  || ! node -e 'try { for (const value of process.argv.slice(1)) { if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)) process.exit(1); } } catch { process.exit(1); }' \
    "$NEXT_PUBLIC_SUPABASE_URL" "$DB_URL"; then
  echo "A running local Supabase stack with anon and service keys is required." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to verify local migration parity." >&2
  exit 1
fi

file_versions=$(
  for migration in supabase/migrations/[0-9]*_*.sql; do
    name=${migration##*/}
    printf '%s\n' "${name%%_*}"
  done | sort
)
if ! db_versions=$(psql "$DB_URL" -Atc 'select version from supabase_migrations.schema_migrations order by version'); then
  echo "Could not read local Supabase migration history." >&2
  exit 1
fi
if [[ "$file_versions" != "$db_versions" ]]; then
  echo "Local Supabase migrations differ from repository migrations:" >&2
  diff -u <(printf '%s\n' "$file_versions") <(printf '%s\n' "$db_versions") >&2 || true
  exit 1
fi

export RLS_TEST_DB_URL="$DB_URL"
export RLS_DB_TESTS=1
export REQUIRE_RLS_DB_TESTS=1

report=$(mktemp)
trap 'rm -f "$report"' EXIT
test_suites=(
  tests/unit/database/*.behavior.test.ts
  tests/unit/database/shared-documents-retire.test.ts
  tests/unit/game-design-system-routes.test.ts
)
if (( $# > 0 )); then
  test_suites=("$@")
fi
npx jest --runInBand --json --outputFile="$report" "${test_suites[@]}"
node -e 'const report = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); if (report.numPendingTests !== 0) { console.error(`${report.numPendingTests} database tests were skipped`); process.exit(1); }' "$report"
