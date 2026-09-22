# Account Playwright Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright coverage for account Credits and implement/test the missing Supabase-backed email-change flow.

**Architecture:** Keep Credits as a browser contract test around the real account page with a sequenced HTTP fixture. Model email change as explicit pure state/error helpers consumed by `AccountEmailSettings`; browser tests control only Supabase Auth responses while exercising the real UI.

**Tech Stack:** Playwright, React 19, Supabase Auth, TanStack Query, Jest, Testing Library, TypeScript.

## Global Constraints

- Supabase Auth remains the sole email identity authority.
- Do not read a real mailbox or persist OTPs in application storage.
- Normalize email comparison with `normalizeEmail`.
- Use response promises and locator assertions; no fixed sleeps.
- Preserve unrelated untracked work in the repository.

---

### Task 1: Account Credits browser contract

**Files:**
- Create: `tests/e2e/helpers/account-credits.ts`
- Create: `tests/e2e/specs/account-credits.spec.ts`
- Test: `tests/e2e/specs/account-credits.spec.ts`

**Interfaces:**
- Consumes: `loginToAccount(page, backend)` from `tests/e2e/helpers/account-storage.ts` and `GET /api/account/credits`.
- Produces: `SequencedCreditsBackend` with `enqueue(status, body)` and `requestCount`.

- [ ] **Step 1: Write the failing Credits Playwright scenarios**

Add tests that return `{ allocated: 12.5, used: 0.0000819, remaining: 12.4999181, overage: 0, deepseekTokens: 21, incompleteCount: 2, trackedFrom: '2026-09-17T00:00:00.000Z' }`, assert all three formatted Credit values and the incomplete warning, then cover successful-load followed by focus refetch `503`, and initial `503` followed by Retry `200`.

```ts
await expect(page.getByTestId('account-credits-allocated')).toHaveText('12.5');
await expect(page.getByTestId('account-credits-used')).toHaveText('0.000082');
await expect(page.getByTestId('account-credits-remaining')).toHaveText('12.499918');
await expect(page.getByRole('status')).toContainText('2 usage records');
```

- [ ] **Step 2: Run the new spec and verify RED**

Run: `npx playwright test tests/e2e/specs/account-credits.spec.ts --project=chromium --workers=1`

Expected: the spec is discovered and fails until the dedicated fixture drives account navigation and refetch deterministically.

- [ ] **Step 3: Implement the sequenced route fixture**

The helper must install `page.route('**/api/account/credits')`, shift one declared response per request, retain the last response only when explicitly configured, and throw on an unexpected extra request. Trigger refresh with `page.evaluate(() => window.dispatchEvent(new Event('focus')))` and assert the previous values remain under the refresh alert.

- [ ] **Step 4: Verify Credits GREEN**

Run: `npx playwright test tests/e2e/specs/account-credits.spec.ts --project=chromium --workers=1`

Expected: all Credits scenarios pass without changing the production Credits component.

- [ ] **Step 5: Commit the Credits coverage**

```bash
git add tests/e2e/helpers/account-credits.ts tests/e2e/specs/account-credits.spec.ts
git commit -m "test: cover account Credits states in Playwright"
```

---

### Task 2: Email-change domain behavior

**Files:**
- Create: `src/lib/auth/emailChange.ts`
- Create: `tests/unit/auth/email-change.test.ts`
- Modify: `tests/unit/auth/account-email-settings.test.tsx`
- Test: `tests/unit/auth/email-change.test.ts`
- Test: `tests/unit/auth/account-email-settings.test.tsx`

**Interfaces:**
- Produces: `validateEmailChangeIdentity(currentEmail, enteredCurrentEmail, nextEmail)`, `emailChangeErrorMessage(error)`, and `pendingEmailFromUser(user)`.
- Consumes: `normalizeEmail` from `src/lib/auth/emailIdentity.ts`.

- [ ] **Step 1: Write failing pure-domain tests**

Cover normalized current-email match, mismatch, unchanged new email, malformed new email, pending `new_email`, duplicate email, incorrect OTP, expired OTP, and generic failure.

```ts
expect(() => validateEmailChangeIdentity('old@example.com', 'other@example.com', 'new@example.com'))
  .toThrow('Current email does not match your signed-in account.');
expect(emailChangeErrorMessage({ message: 'Token has expired' })).toBe('This verification code has expired.');
```

- [ ] **Step 2: Run domain tests and verify RED**

Run: `npx jest --runInBand tests/unit/auth/email-change.test.ts`

Expected: FAIL because `emailChange.ts` does not exist.

- [ ] **Step 3: Implement the minimal domain module**

Use a conservative email pattern matching `payment-domain.ts`, return normalized values from validation, inspect only stable error message text, and treat `user.new_email` as pending only when it differs from `user.email`.

```ts
export type ValidEmailChange = { currentEmail: string; newEmail: string };
export function validateEmailChangeIdentity(
  authoritativeEmail: string,
  enteredCurrentEmail: string,
  enteredNewEmail: string,
): ValidEmailChange;
```

- [ ] **Step 4: Replace the read-only component test with failing interaction tests**

Mock `getUser`, `updateUser`, and `verifyOtp`. Assert a mismatch does not call `updateUser`; a match calls `updateUser({ email: 'new@example.com' })`; successful verification calls `verifyOtp({ email: 'new@example.com', token: '123456', type: 'email_change' })`, reloads the user, and renders the new current email; wrong and expired codes retain the form.

- [ ] **Step 5: Run component tests and verify RED**

Run: `npx jest --runInBand tests/unit/auth/account-email-settings.test.tsx`

Expected: FAIL because the component still renders read-only content.

---

### Task 3: Email-change account UI

**Files:**
- Modify: `src/components/account/AccountEmailSettings.tsx`
- Modify: `src/components/account/AccountEmailSettings.module.css`
- Test: `tests/unit/auth/account-email-settings.test.tsx`

**Interfaces:**
- Consumes: the Task 2 email-change helpers and Supabase Auth `getUser`, `updateUser`, `verifyOtp`.
- Produces: accessible `Current email`, `New email`, `Verification code`, `Change email`, `Verify email`, and `Cancel` controls.

- [ ] **Step 1: Implement the request state**

Add controlled current/new email inputs, disable submission while pending, validate identity before calling Supabase, and switch to verification state only after `updateUser` succeeds. Do not log Supabase errors or tokens.

- [ ] **Step 2: Implement verification and reload restoration**

On load, derive `currentEmail` and pending `new_email` from `getUser`. On Verify, call `verifyOtp`, refetch `getUser`, then clear the form only when the authoritative email changes. Render mapped wrong/expired errors in `role="alert"`.

- [ ] **Step 3: Add responsive form styling**

Use the existing 760px account column, native labels/inputs/buttons, 7px-or-less radii, stable 40px control heights, and a single-column layout under 640px. Keep letter spacing at `0`.

- [ ] **Step 4: Verify component GREEN**

Run: `npx jest --runInBand tests/unit/auth/email-change.test.ts tests/unit/auth/account-email-settings.test.tsx`

Expected: both suites pass.

- [ ] **Step 5: Commit the email UI**

```bash
git add src/lib/auth/emailChange.ts src/components/account/AccountEmailSettings.tsx src/components/account/AccountEmailSettings.module.css tests/unit/auth/email-change.test.ts tests/unit/auth/account-email-settings.test.tsx
git commit -m "feat: add verified account email changes"
```

---

### Task 4: Email-change Playwright flow

**Files:**
- Modify: `tests/e2e/specs/account-email.spec.ts`
- Create: `tests/e2e/helpers/account-email.ts`
- Test: `tests/e2e/specs/account-email.spec.ts`

**Interfaces:**
- Produces: an Auth fixture that handles `GET/PUT /auth/v1/user` and `POST /auth/v1/verify`, records request bodies, and exposes `setPendingEmail`.

- [ ] **Step 1: Write the failing browser scenarios**

Add independent scenarios for old-email mismatch, request/OTP success, incorrect OTP, expired OTP, and reload with `new_email` pending. Assert mismatch causes zero PUT requests and success displays the normalized new current email after verification.

- [ ] **Step 2: Run and verify RED**

Run: `npx playwright test tests/e2e/specs/account-email.spec.ts --project=chromium --workers=1`

Expected: FAIL until the endpoint fixture reflects the exact Supabase client request shapes.

- [ ] **Step 3: Complete the Auth fixture and selectors**

Return a full user object from `/auth/v1/user`, distinguish request methods, return `{ code: 403, msg: 'Token has expired' }` for expired OTP, and avoid intercepting unrelated application APIs.

- [ ] **Step 4: Verify account flows twice**

Run twice: `npx playwright test tests/e2e/specs/account-credits.spec.ts tests/e2e/specs/account-email.spec.ts --project=chromium --workers=1`

Expected: both runs pass with identical request counts.

- [ ] **Step 5: Run focused static checks and commit**

```bash
npx eslint src/lib/auth/emailChange.ts src/components/account/AccountEmailSettings.tsx tests/e2e/helpers/account-email.ts tests/e2e/specs/account-email.spec.ts tests/e2e/helpers/account-credits.ts tests/e2e/specs/account-credits.spec.ts
npx tsc --noEmit --pretty false
git add tests/e2e/helpers/account-email.ts tests/e2e/specs/account-email.spec.ts
git commit -m "test: cover account email change flows"
```
