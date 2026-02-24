#!/bin/bash
# Clean test data in remote Supabase database
# This script should be run before E2E tests in CI/CD

set -e

echo "🧹 Cleaning test data from remote Supabase..."

# Check if SUPABASE_DB_URL is set
if [ -z "$SUPABASE_DB_URL" ]; then
  echo "❌ Error: SUPABASE_DB_URL environment variable is not set"
  echo "Please set it to your remote database connection string"
  exit 1
fi

# Run the cleanup SQL
psql "$SUPABASE_DB_URL" -f supabase/clean-test-data.sql

echo "✅ Test data cleaned successfully"

