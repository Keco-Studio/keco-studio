#!/bin/bash
# Seed remote Supabase database with test users
# This script executes supabase/seed-remote.sql on the remote database

set -e

# Check if SUPABASE_DB_URL is set
if [ -z "$SUPABASE_DB_URL" ]; then
  echo "Error: SUPABASE_DB_URL environment variable must be set"
  echo "Format: postgresql://postgres:[password]@[host]:[port]/postgres"
  exit 1
fi

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SEED_FILE="$PROJECT_ROOT/supabase/seed-remote.sql"

if [ ! -f "$SEED_FILE" ]; then
  echo "Error: Seed file not found at $SEED_FILE"
  exit 1
fi

echo "Seeding remote Supabase database..."
echo "Using seed file: $SEED_FILE"

# Execute the seed SQL file using psql
psql "$SUPABASE_DB_URL" -f "$SEED_FILE"

echo "Seed data applied successfully!"

