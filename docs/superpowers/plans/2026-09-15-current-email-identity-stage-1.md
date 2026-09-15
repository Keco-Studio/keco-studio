# Current Email Identity Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make current account emails normalized and unique, synchronize profile email from Supabase Auth, bind invitations to user UUIDs, add link-confirmed email changes, and repair the existing password-recovery flow without implementing six-digit OTP entry.

**Architecture:** Supabase Auth remains the identity source and `auth.users.id` remains the authorization key. A migration enforces normalized current-email uniqueness and projects Auth email changes into `public.profiles`; UI code only normalizes inputs and reports provider outcomes. Pending invitations gain a recipient UUID so email reuse cannot transfer access, while account settings use Supabase's existing email-change confirmation links.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Auth/PostgreSQL, Jest, Playwright

**Spec:** `docs/superpowers/specs/2026-09-15-current-email-identity-and-verification-design.md`

## Global Constraints

- This plan implements Stage 1 only; do not add six-digit code fields, custom OTP storage, or mandatory signup confirmation.
- Normalize with `trim().toLowerCase()` only; do not remove dots, plus suffixes, or otherwise rewrite provider-specific addresses.
- `auth.users.id` owns authorization and resources; email is never an authorization key.
- `auth.users.email` is authoritative; `profiles.email` is a synchronized copy and cannot be directly edited by authenticated clients.
- An old email is released after a completed email change or account deletion; no history or reservation table is created.
- Password recovery remains a one-time Supabase recovery link.
- Preserve all unrelated dirty-worktree changes, especially the in-progress Keco Admin work.

---

### Task 1: Normalized Current-Email Contract

**Files:**
- Create: `src/lib/auth/emailIdentity.ts`
- Create: `tests/unit/auth/email-identity.test.ts`
- Modify: `src/components/authform/AuthForm.tsx`
- Test: `tests/unit/auth/email-identity.test.ts`

**Interfaces:**
- Produces: `normalizeEmail(value: string): string`
- Produces: `isDuplicateEmailError(error: unknown): boolean`
- Consumes: Supabase `signUp({ email, password, options })` and `signInWithPassword({ email, password })`

- [ ] **Step 1: Write failing normalization and duplicate-error tests**

```ts
expect(normalizeEmail('  User.Name+tag@Example.COM  '))
  .toBe('user.name+tag@example.com');
expect(normalizeEmail('a.b@gmail.com')).not.toBe(normalizeEmail('ab@gmail.com'));
expect(isDuplicateEmailError({ message: 'User already registered' })).toBe(true);
expect(isDuplicateEmailError({ message: 'Network request failed' })).toBe(false);
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- --runInBand tests/unit/auth/email-identity.test.ts`

Expected: FAIL because `@/lib/auth/emailIdentity` does not exist.

- [ ] **Step 3: Implement the shared helper**

```ts
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isDuplicateEmailError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : '';
  return /already registered|already exists|email.*in use/i.test(message);
}
```

- [ ] **Step 4: Apply normalization at registration and login**

In `AuthForm.tsx`, normalize before both Auth calls. Map duplicate signup errors to `An account with this email already exists.` and leave all other provider errors intact. Do not add a preflight availability lookup because it races and exposes account existence beyond the signup operation.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- --runInBand tests/unit/auth/email-identity.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the helper and form behavior**

```bash
git add src/lib/auth/emailIdentity.ts src/components/authform/AuthForm.tsx tests/unit/auth/email-identity.test.ts
git commit -m "fix: normalize account email inputs"
```

### Task 2: Database Uniqueness and Auth-to-Profile Synchronization

**Files:**
- Create: `supabase/migrations/20260915120000_current_email_identity.sql`
- Create: `tests/unit/database/current-email-identity-migration.test.ts`
- Modify: `src/lib/contexts/AuthContext.tsx`

**Interfaces:**
- Produces: unique normalized indexes `users_current_email_normalized_key` and `profiles_current_email_normalized_key`
- Produces: trigger function `public.sync_profile_email_from_auth_user()`
- Consumes: `auth.users(id, email)` and `public.profiles(id, email)`

- [ ] **Step 1: Write a failing migration contract test**

Read the migration as text and assert it contains: a preflight duplicate query using `lower(btrim(email))`; unique partial indexes for Auth and profiles; an `AFTER INSERT OR UPDATE OF email ON auth.users` trigger; profile backfill from Auth; and column-level profile update grants that exclude `email`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --runInBand tests/unit/database/current-email-identity-migration.test.ts`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Add the migration preflight and constraints**

```sql
do $$
begin
  if exists (
    select 1 from auth.users
    where email is not null
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'duplicate normalized auth email groups must be resolved';
  end if;
end $$;

create unique index users_current_email_normalized_key
  on auth.users (lower(btrim(email))) where email is not null;
create unique index profiles_current_email_normalized_key
  on public.profiles (lower(btrim(email))) where email is not null;
```

Before creating the profile index, backfill `profiles.email` from the matching Auth row. Normalize values written by `handle_new_user` and add an Auth-email update trigger that updates only the matching profile ID. Use `security definer set search_path = ''` and schema-qualified objects.

- [ ] **Step 4: Prevent client-owned profile email changes**

Revoke table-level profile updates from `authenticated`, then grant update only on `username`, `avatar_url`, `full_name`, and `avatar_color`. Keep the existing RLS ownership policy. Change the AuthContext missing-profile fallback so it inserts the Auth email but never updates an existing profile email.

- [ ] **Step 5: Verify GREEN and migration applicability**

Run: `npm test -- --runInBand tests/unit/database/current-email-identity-migration.test.ts tests/unit/auth-profile-stability.test.ts`

When local Supabase is available, run: `supabase db reset`

Expected: tests pass; reset completes; duplicate normalized email insertion fails with PostgreSQL code `23505`; changing `auth.users.email` updates `profiles.email`; deleting the Auth user removes its profile and releases the unique email.

- [ ] **Step 6: Commit the database contract**

```bash
git add supabase/migrations/20260915120000_current_email_identity.sql tests/unit/database/current-email-identity-migration.test.ts src/lib/contexts/AuthContext.tsx
git commit -m "feat: enforce current email identity"
```

### Task 3: Account Email-Change Page

**Files:**
- Create: `src/app/(dashboard)/account/page.tsx`
- Create: `src/components/account/AccountEmailSettings.tsx`
- Create: `src/components/account/AccountEmailSettings.module.css`
- Create: `tests/unit/auth/account-email-settings.test.tsx`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/lib/auth/proxyPolicy.ts`
- Test: `tests/unit/auth/account-email-settings.test.tsx`
- Test: `tests/unit/auth/proxy-policy.test.ts`

**Interfaces:**
- Consumes: `normalizeEmail(value: string): string`
- Consumes: `supabase.auth.getUser()` and `supabase.auth.updateUser({ email }, { emailRedirectTo })`
- Produces: protected route `/account`

- [ ] **Step 1: Write failing account-page tests**

Test that the component displays the current Auth email, rejects an empty/unchanged address, normalizes the request, calls:

```ts
supabase.auth.updateUser(
  { email: 'new@example.com' },
  { emailRedirectTo: `${window.location.origin}/auth/callback?redirect=/account` },
);
```

and reports that confirmation messages were sent without claiming the email already changed. Test duplicate-email and provider-error states.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --runInBand tests/unit/auth/account-email-settings.test.tsx`

Expected: FAIL because the account component does not exist.

- [ ] **Step 3: Implement the account page and menu entry**

Create a restrained account settings view using existing shell typography and spacing. Add `Account` to the avatar menu before Billing, navigate with `router.push('/account')`, and close the menu. The page must load the email from `auth.getUser()`, not trust `profiles.email`, and disable submission while pending.

- [ ] **Step 4: Preserve protected-route behavior**

`/account` remains protected through the existing default policy; add a proxy-policy assertion that unauthenticated access is handled like other dashboard pages. Do not add it to `PUBLIC_PAGE_PATHS`.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- --runInBand tests/unit/auth/account-email-settings.test.tsx tests/unit/auth/proxy-policy.test.ts tests/unit/keco-admin/keco-admin-navigation.test.ts`

Expected: PASS, including existing Keco Admin menu ordering and visibility tests.

- [ ] **Step 6: Commit account email changes**

```bash
git add 'src/app/(dashboard)/account/page.tsx' src/components/account src/components/layout/TopBar.tsx src/lib/auth/proxyPolicy.ts tests/unit/auth/account-email-settings.test.tsx tests/unit/auth/proxy-policy.test.ts
git commit -m "feat: add account email change flow"
```

### Task 4: UUID-Bound Collaboration Invitations

**Files:**
- Create: `supabase/migrations/20260915130000_bind_invitations_to_recipient_uuid.sql`
- Create: `tests/unit/database/invitation-recipient-identity-migration.test.ts`
- Create: `tests/unit/collaboration/invitation-recipient-identity.test.ts`
- Modify: `src/app/api/invitations/route.ts`
- Modify: `src/app/api/invitations/accept/route.ts`
- Modify: `src/lib/services/collaborationService.ts`
- Modify: `src/lib/hooks/useProjectCollaborators.ts`

**Interfaces:**
- Produces: nullable-for-legacy `collaboration_invitations.recipient_user_id uuid references public.profiles(id) on delete cascade`
- Consumes: synchronized, normalized `profiles.email`
- Acceptance rule: `invitation.recipient_user_id === authenticated user.id`

- [ ] **Step 1: Write failing migration and behavior tests**

Assert that the migration adds/indexes/backfills `recipient_user_id`, and that both creation paths insert it. Test acceptance with the same email but a different UUID and expect rejection; test the original UUID after changing email and expect acceptance. Test legacy `NULL` recipient UUID as fail-closed.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --runInBand tests/unit/database/invitation-recipient-identity-migration.test.ts tests/unit/collaboration/invitation-recipient-identity.test.ts`

Expected: FAIL because invitations are currently authorized by token email.

- [ ] **Step 3: Add and backfill the recipient UUID**

Add the nullable column for compatibility, backfill only unambiguous normalized matches, add an index on `(project_id, recipient_user_id)` for pending rows, and use `ON DELETE CASCADE` so deletion prevents later email reuse from claiming pending invitations. Leave unresolved legacy rows nullable so acceptance can reject them rather than guessing.

- [ ] **Step 4: Update both invitation creation paths**

Normalize the requested email, resolve exactly one synchronized profile, require a registered recipient, and insert `recipient_user_id: recipientProfile.id`. Self-invitation, already-collaborator, and pending-invitation checks use UUID. Preserve `recipient_email` as the delivery/display snapshot.

- [ ] **Step 5: Change acceptance and collaborator display**

Load the invitation before identity authorization, reject missing/null/mismatched `recipient_user_id`, and remove token-email authorization. Keep signed JWT validation for invitation ID and expiry. In `useProjectCollaborators`, select `recipient_user_id` and resolve pending display data by UUID instead of joining profiles by mutable email.

- [ ] **Step 6: Verify GREEN**

Run: `npm test -- --runInBand tests/unit/collaboration-service-errors.test.ts tests/unit/collaboration tests/unit/database/invitation-recipient-identity-migration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit UUID-bound invitations**

```bash
git add supabase/migrations/20260915130000_bind_invitations_to_recipient_uuid.sql tests/unit/database/invitation-recipient-identity-migration.test.ts tests/unit/collaboration src/app/api/invitations src/lib/services/collaborationService.ts src/lib/hooks/useProjectCollaborators.ts
git commit -m "fix: bind collaboration invitations to user UUIDs"
```

### Task 5: Password-Recovery Corrections

**Files:**
- Modify: `src/app/forgot-password/page.tsx`
- Modify: `src/app/auth/reset-password/page.tsx`
- Modify: `src/components/authform/AuthForm.tsx`
- Modify: `tests/e2e/specs/password-reset.spec.ts`
- Create: `tests/unit/auth/password-recovery-ui.test.ts`

**Interfaces:**
- Consumes: `normalizeEmail(value: string): string`
- Consumes: Supabase `resetPasswordForEmail` and recovery-session `updateUser`
- Password minimum: 12 characters, matching `supabase/config.toml`

- [ ] **Step 1: Write failing UI-contract tests**

Assert that the request form label and placeholder are email-only, the success copy is non-enumerating (`If an account exists for this email, you will receive a password reset link.`), reset validation requires 12 characters, and the login link says `Forgot your password?`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- --runInBand tests/unit/auth/password-recovery-ui.test.ts`

Expected: FAIL on the current username label, six-character rule, and typo.

- [ ] **Step 3: Repair request and reset behavior**

Normalize the email with the shared helper. On a successful provider response,
always show the same success copy whether or not the address exists. For a
provider failure, show a generic unavailable/rate-limit message that does not
reveal account existence; do not falsely claim delivery. Change the reset
minimum to 12 and preserve invalid/expired recovery-link handling.

- [ ] **Step 4: Update end-to-end expectations**

Change selectors and expected copy, add a password shorter than 12 case, then keep the successful `NewPassword123!` recovery assertion.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- --runInBand tests/unit/auth/password-recovery-ui.test.ts`

Run when local Auth/Mailpit are available: `npx playwright test tests/e2e/specs/password-reset.spec.ts --workers=1`

Expected: unit and end-to-end tests pass.

- [ ] **Step 6: Commit recovery fixes**

```bash
git add src/app/forgot-password/page.tsx src/app/auth/reset-password/page.tsx src/components/authform/AuthForm.tsx tests/unit/auth/password-recovery-ui.test.ts tests/e2e/specs/password-reset.spec.ts
git commit -m "fix: harden password recovery flow"
```

### Task 6: Stage 1 Regression Verification

**Files:**
- Modify only if a verification failure is caused by Stage 1 changes.

**Interfaces:**
- Consumes all Stage 1 outputs.
- Produces a verified Stage 1 handoff with OTP explicitly deferred.

- [ ] **Step 1: Run focused tests**

```bash
npm test -- --runInBand \
  tests/unit/auth \
  tests/unit/collaboration-service-errors.test.ts \
  tests/unit/collaboration \
  tests/unit/database/current-email-identity-migration.test.ts \
  tests/unit/database/invitation-recipient-identity-migration.test.ts
```

- [ ] **Step 2: Run static and type verification**

```bash
npm run typecheck
npm run lint
git diff --check
```

- [ ] **Step 3: Run local database and browser verification when services are available**

```bash
supabase db reset
npx playwright test tests/e2e/specs/password-reset.spec.ts --workers=1
```

Verify manually that `/account` requests an email change, the confirmation callback returns to `/account`, old email is released only after confirmation, and no six-digit verification control appears in Stage 1.

- [ ] **Step 4: Review the final diff for scope and dirty-worktree preservation**

Run: `git status --short && git diff --stat HEAD~5..HEAD`

Expected: only planned Stage 1 files plus the user's pre-existing unrelated changes; no OTP implementation and no reverted Keco Admin work.
