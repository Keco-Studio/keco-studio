#!/usr/bin/env bash

set -euo pipefail

BASE_COMMIT="${1:?usage: detect-migration-changes.sh <base-commit>}"

git diff --name-only "$BASE_COMMIT" HEAD -- supabase/migrations/
