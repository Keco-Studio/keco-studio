#!/usr/bin/env bash
set -euo pipefail

exec bash scripts/test-unit-db.sh \
  tests/unit/database/account-credit-ledger-migration.test.ts \
  tests/unit/database/account-credit-summary-indexes-migration.test.ts \
  tests/unit/database/ai-usage-accounting.behavior.test.ts \
  tests/unit/database/account-credit-ledger.behavior.test.ts
