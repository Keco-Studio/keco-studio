# Scripts

## seed-via-api.ts (Recommended)

Seeds the remote Supabase database with test users via **Supabase Admin API**. This is the **recommended approach** for CI environments as it:
- ✅ Avoids direct database connection issues (IPv6, firewall, etc.)
- ✅ Works reliably in GitHub Actions
- ✅ Uses official Supabase APIs
- ✅ Supports valid email domains for CI environments

### Usage

```bash
npm run seed:api
# or
npx tsx scripts/seed-via-api.ts
```

### Requirements

- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (with admin privileges)

### What it does

Creates test users with known passwords via Supabase Admin API:
- `seed-empty@mailinator.com` / `Password123!` (empty account)
- `seed-empty-2@mailinator.com` / `Password123!` (empty account)
- `seed-empty-3@mailinator.com` / `Password123!` (empty account)
- `seed-empty-4@mailinator.com` / `Password123!` (empty account)
- `seed-project@mailinator.com` / `Password123!` (has one project)
- `seed-library@mailinator.com` / `Password123!` (has one project with one library)

> **Note**: Using `@mailinator.com` instead of `@example.com` because some CI environments reject invalid email domains.

### Setting up in GitHub Actions

1. Add secrets to your repository:
   - Go to repository settings → Secrets and variables → Actions
   - Add `NEXT_PUBLIC_SUPABASE_URL`: `https://[your-project-ref].supabase.co`
   - Add `SUPABASE_SERVICE_ROLE_KEY`: Found in Supabase Dashboard → Project Settings → API → Service Role Key (⚠️ Keep this secret!)

2. The GitHub Actions workflow will automatically run `npm run seed:api` before tests

### Features

- ✨ Idempotent: Won't create duplicate users
- ✨ Creates associated data (projects, libraries) for specific test users
- ✨ Provides detailed logging of the seeding process
- ✨ Skips users that already exist
- ✨ Handles errors gracefully

---

## seed-remote.sh (Legacy - Direct DB Connection)

⚠️ **This method may fail in GitHub Actions due to IPv6/network issues.** Use `seed-via-api.ts` instead.

Seeds the remote Supabase database with test users by directly connecting to PostgreSQL.

### Usage

```bash
./scripts/seed-remote.sh
```

### Requirements

- `SUPABASE_DB_URL` environment variable
- Format: `postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres`
- `psql` must be installed

### Limitations

- ❌ May fail with IPv6 connection errors in CI
- ❌ Requires direct database access (firewall issues)
- ❌ More complex setup and troubleshooting

