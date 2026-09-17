#!/usr/bin/env bash
set -euo pipefail

eval "$(npx supabase status -o env)"

export NEXT_PUBLIC_SUPABASE_URL="${API_URL:-}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY:-}"
export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-}"
export RLS_DB_TESTS=1
export REQUIRE_RLS_DB_TESTS=1

exec npx jest --runInBand \
  tests/unit/database/account-credit-ledger-migration.test.ts \
  tests/unit/database/account-credit-summary-indexes-migration.test.ts \
  tests/unit/database/ai-usage-accounting.behavior.test.ts \
  tests/unit/database/account-credit-ledger.behavior.test.ts
