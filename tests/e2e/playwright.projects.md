# Playwright Test Execution Order

## Test Dependencies

Our E2E tests have dependencies that require specific execution order:

1. **happy-path.spec.ts** - Creates test data (Project → Folders → Libraries → Assets)
2. **destructive.spec.ts** - Deletes the test data created by happy-path

## Why Sequential Execution?

- `destructive.spec.ts` **depends on** data created by `happy-path.spec.ts`
- Both tests use the same user account (`users.seedEmpty`)
- Tests must run in order: happy-path first, then destructive

## Current Configuration

```typescript
// playwright.config.ts
fullyParallel: false,  // Tests run sequentially
workers: 1,            // Only 1 worker to maintain order
```

## Alternative: Use Different Users

To enable parallel testing, modify tests to use different user accounts:

- `happy-path.spec.ts` → `users.seedEmpty2`
- `destructive.spec.ts` → `users.seedEmpty3`

Then set:
```typescript
fullyParallel: true,
workers: process.env.CI ? 2 : undefined,
```

## Verifying Test Order

Run tests and check execution order:
```bash
npx playwright test --list
```

Expected output:
```
happy-path.spec.ts
destructive.spec.ts
```

