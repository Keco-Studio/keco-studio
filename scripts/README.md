# Scripts

## seed-remote.sh

Seeds the remote Supabase database with test users for E2E testing in GitHub Actions.

### Usage

```bash
./scripts/seed-remote.sh
```

### Requirements

- `SUPABASE_DB_URL` environment variable must be set
- Format: `postgresql://postgres:[password]@[host]:[port]/postgres`
- `psql` must be installed (PostgreSQL client)

### What it does

1. Executes `supabase/seed-remote.sql` on the remote database
2. Creates test users with known passwords:
   - `seed-empty@example.com` / `Password123!`
   - `seed-empty-2@example.com` / `Password123!`
   - `seed-empty-3@example.com` / `Password123!`
   - `seed-empty-4@example.com` / `Password123!`
   - `seed-project@example.com` / `Password123!` (has one project)
   - `seed-library@example.com` / `Password123!` (has one project with one library)

### Setting up in GitHub Actions

1. Add `SUPABASE_DB_URL` as a GitHub Secret:
   - Go to your repository settings → Secrets and variables → Actions
   - Add a new secret named `SUPABASE_DB_URL`
   - Value: `postgresql://postgres:[your-db-password]@db.[your-project-ref].supabase.co:5432/postgres`
   - You can find the database password in your Supabase project settings → Database → Connection string

2. The GitHub Actions workflow (`.github/workflows/playwright.yml`) will automatically:
   - Install PostgreSQL client
   - Run the seed script before tests (if `SUPABASE_DB_URL` is set)
   - Continue even if seeding fails (so tests can still run)

### Notes

- The script is idempotent: it safely handles existing users and won't create duplicates
- The `seed-remote.sql` file dynamically gets the `instance_id` from the remote database
- This is different from `supabase/seed.sql` which uses a hardcoded local instance_id

