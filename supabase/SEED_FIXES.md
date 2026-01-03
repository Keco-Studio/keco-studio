# Seed Files Bug Fixes

## Summary
Fixed multiple column name mismatches between seed files and actual database schema.

## Issues Fixed

### 1. ❌ library_assets.description
**Problem**: Tried to insert into non-existent `description` column  
**Table Schema**: `library_assets` only has: `id`, `library_id`, `name`, `created_at`  
**Fix**: Removed `description` from all `library_assets` INSERT statements

**Files Modified**:
- `seed.sql` - 2 occurrences fixed
- `seed-remote.sql` - 2 occurrences fixed
- `tests/e2e/fixures/destructive-data.ts` - 2 occurrences fixed

### 2. ❌ library_field_definitions column names
**Problem**: Used wrong column names in INSERT statements  
**Table Schema** (correct):
```sql
create table library_field_definitions (
  id uuid,
  library_id uuid,
  section text,
  label text,                -- NOT field_label
  data_type text,           -- NOT field_type
  enum_options text[],
  required boolean,         -- NOT is_required
  order_index int,          -- NOT position_in_section
  created_at timestamptz
);
```

**Wrong → Correct Mappings**:
- `field_label` → `label`
- `field_type` → `data_type`
- `is_required` → `required`
- `position_in_section` → `order_index`

**Files Modified**:
- `seed.sql` - 2 occurrences fixed
- `seed-remote.sql` - 2 occurrences fixed

### 3. ❌ Invalid data_type value
**Problem**: Used `'text'` as data_type, which is not in allowed values  
**Constraint**: `data_type in ('string','int','float','boolean','enum','date')`  
**Fix**: Changed `'text'` → `'string'`

**Files Modified**:
- `seed.sql` - 4 occurrences fixed
- `seed-remote.sql` - 4 occurrences fixed

## Verified Correct Tables

✅ **auth.users** - Using standard Supabase auth schema (no issues)
✅ **projects** - `id`, `owner_id`, `name`, `description`, `created_at`, `updated_at`
✅ **folders** - `id`, `project_id`, `name`, `description`, `created_at`, `updated_at`
✅ **libraries** - `id`, `project_id`, `folder_id`, `name`, `description`, `created_at`, `updated_at`
✅ **library_assets** - `id`, `library_id`, `name`, `created_at`
✅ **library_field_definitions** - `id`, `library_id`, `section`, `label`, `data_type`, `enum_options`, `required`, `order_index`, `created_at`

## Testing

Run database reset to verify fixes:
```bash
npm run db:reset
```

Expected result: ✅ Seeding completes successfully without errors

## Notes

- All column names now match the actual database schema from migrations
- Used correct data types according to CHECK constraints
- Both local (`seed.sql`) and remote (`seed-remote.sql`) files are in sync

