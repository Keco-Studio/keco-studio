# Scripts

## CI seeding

GitHub Actions Playwright tests do **not** run `npm run seed:api`.

The current Playwright workflow starts local Supabase and runs
`supabase db reset`, which applies `supabase/seed.sql`. That SQL file creates
the CI/E2E test users used by the Playwright specs.

## seed-via-api.ts (manual remote seeding)

Seeds a remote Supabase database with test users via **Supabase Admin API**.
Use this for manual remote environments when you need API-based seeding. It:
- ✅ Avoids direct database connection issues (IPv6, firewall, etc.)
- ✅ Avoids direct database access
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

### Manual remote setup

1. Export the remote Supabase variables in your local shell or maintenance
   environment:
   - `NEXT_PUBLIC_SUPABASE_URL`: `https://[your-project-ref].supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`: Found in Supabase Dashboard → Project Settings → API → Service Role Key (⚠️ Keep this secret!)

2. Run `npm run seed:api` from a trusted local environment or maintenance job when remote test users need to be created/refreshed.

### Features

- ✨ Idempotent: Won't create duplicate users
- ✨ Creates associated data (projects, libraries) for specific test users
- ✨ Provides detailed logging of the seeding process
- ✨ Skips users that already exist
- ✨ Handles errors gracefully

---

## seed-remote.sh (Legacy - Direct DB Connection)

⚠️ **This method may fail in remote environments due to IPv6/network access issues.** Use `seed-via-api.ts` instead when direct database access is unavailable.

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

---

## Simulation exports (moved)

Economy / battle `.xlsx` export scripts used to live here; they now run from the sibling repo **`../keco-simulation`**:

```bash
cd ../keco-simulation
npm run export:simulation-xlsx
npm run export:battle-simulation-xlsx
```

See `../keco-simulation/README.md` for local dev and iframe embedding from Keco.
