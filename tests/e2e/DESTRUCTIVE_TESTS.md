# Destructive Tests Documentation

## Overview

This project includes two types of destructive tests for validating deletion functionality:

1. **`destructive.spec.ts`** - Depends on `happy-path.spec.ts` creating data first
2. **`destructive-standalone.spec.ts`** - Uses pre-seeded accounts (independent)

## Pre-seeded Destructive Test Accounts

The database seed files include dedicated accounts with complete test data for deletion testing.

### Account 1: `seed-destruct-1@mailinator.com`
- **Email**: `seed-destruct-1@mailinator.com`
- **Password**: `Password123!`
- **Pre-populated data**:
  - Project: "Destruct Test Project 1"
  - Folder: "Test Folder 1"
  - Library: "Test Library 1" (inside folder)
  - Root Library: "Root Library 1" (at project root)
  - Asset: "Test Asset 1" (in Test Library 1)

### Account 2: `seed-destruct-2@mailinator.com`
- **Email**: `seed-destruct-2@mailinator.com`
- **Password**: `Password123!`
- **Pre-populated data**:
  - Project: "Destruct Test Project 2"
  - Folder: "Test Folder 2"
  - Library: "Test Library 2" (inside folder)
  - Root Library: "Root Library 2" (at project root)
  - Asset: "Test Asset 2" (in Test Library 2)

## Setup

### Local Development

1. **Reset and seed the database**:
   ```bash
   npm run db:reset
   ```
   This will run the seed files that create the destructive test accounts.

2. **Verify seeding**:
   ```bash
   # Check if the accounts exist
   npm run supabase db inspect
   ```

### CI/Remote Environment

The `seed-remote.sql` file includes the same accounts with idempotent logic, so running it multiple times is safe.

## Running Tests

### Run Standalone Destructive Tests (Recommended)

```bash
# Run the standalone destructive tests
npm run test:e2e -- destructive-standalone

# Run in UI mode for debugging
npm run test:e2e:ui -- destructive-standalone
```

### Run Dependent Destructive Tests

```bash
# Must run happy-path first to create data
npm run test:e2e -- happy-path
npm run test:e2e -- destructive
```

## Test Structure

### Standalone Test Flow

```
1. Login with pre-seeded account
2. Navigate to pre-existing project
3. Delete entities in order:
   - Asset → Library → Root Library → Folder → Project
4. Verify each deletion
5. Verify navigation after project deletion
```

### Data Hierarchy

```
User (seed-destruct-1)
└── Project (Destruct Test Project 1)
    ├── Folder (Test Folder 1)
    │   └── Library (Test Library 1)
    │       ├── Field Definitions (Name, Type, Description)
    │       └── Asset (Test Asset 1)
    └── Root Library (Root Library 1)
```

## Advantages of Pre-seeded Accounts

✅ **Independent**: No dependency on other tests creating data  
✅ **Fast**: Skip creation steps, go straight to deletion testing  
✅ **Parallel**: Multiple accounts allow parallel test execution  
✅ **Reliable**: Known state, consistent across environments  
✅ **Repeatable**: Re-run seed to reset accounts  

## Resetting Test Data

If a destructive test fails or you need fresh data:

```bash
# Local
npm run db:reset

# Remote (requires SUPABASE_DB_PASSWORD)
npm run db:seed:remote
```

## Fixtures

All test data is defined in fixtures:

- **Users**: `tests/e2e/fixures/users.ts`
  - `users.seedDestruct1`
  - `users.seedDestruct2`

- **Data**: `tests/e2e/fixures/destructive-data.ts`
  - `destructData1` (for account 1)
  - `destructData2` (for account 2)

## Best Practices

1. **Always run standalone tests**: They're more reliable and faster
2. **Use different accounts for parallel runs**: Account 1 and Account 2
3. **Reset database between test runs**: Ensures clean state
4. **Check CI logs**: Verify seeding completed successfully

## Troubleshooting

### Tests fail with "Project not found"

**Cause**: Database not seeded properly  
**Solution**: Run `npm run db:reset`

### Tests fail with "Already deleted"

**Cause**: Test ran previously without resetting  
**Solution**: Run `npm run db:reset` before running tests again

### Tests timeout

**Cause**: UI elements not loading  
**Solution**: 
1. Check if app is running: `npm run dev`
2. Increase timeout in test file
3. Run in UI mode to debug: `npm run test:e2e:ui`

## Notes

- The seed files are idempotent - safe to run multiple times
- Pre-seeded accounts are separate from happy-path test accounts
- Each account has complete data hierarchy for comprehensive testing
- Field definitions are created automatically during seeding

