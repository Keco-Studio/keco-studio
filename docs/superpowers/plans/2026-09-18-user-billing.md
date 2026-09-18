# User Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Billing as a user-level route and remove the project dependency from Checkout.

**Architecture:** The UI owns a single `/billing` route. Checkout receives an authenticated user's plan and email, creates a payment order with no project association, and routes Stripe outcomes back to the global Billing page.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase, Stripe, Jest.

**Spec:** `docs/superpowers/specs/2026-09-18-user-billing-design.md`

## Global Constraints

- Billing is user-level and must never require a current project.
- New payment orders must preserve a null `project_id`.
- Existing payment orders and Credit-grant behavior remain unchanged.
- Do not retain the `/{projectId}/billing` route.

---

### Task 1: Make Checkout input account-level

**Files:**
- Modify: `tests/unit/payment/payment-domain.test.ts`
- Modify: `src/lib/payment-domain.ts`

**Interfaces:**
- Produces: `CheckoutInput` with `planId: string` and `customerEmail: string`.
- Consumes: `validateCheckoutInput(value: unknown): CheckoutInput` in `src/app/api/checkout/route.ts`.

- [ ] **Step 1: Write the failing test**

```ts
expect(validateCheckoutInput({ planId: 'plan-pro', customerEmail: 'payer@example.com' }))
  .toEqual({ planId: 'plan-pro', customerEmail: 'payer@example.com' });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/payment/payment-domain.test.ts`
Expected: FAIL because a project ID is still required.

- [ ] **Step 3: Write minimal implementation**

```ts
export type CheckoutInput = { planId: string; customerEmail: string };
```

Remove parsing and validation of `projectId`, while retaining non-empty plan and valid email validation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/payment/payment-domain.test.ts`
Expected: PASS.

### Task 2: Remove project-scoped Checkout behavior

**Files:**
- Modify: `src/app/api/checkout/route.ts`
- Modify: `src/lib/supabase-payments.ts`

**Interfaces:**
- Consumes: account-level `CheckoutInput` from Task 1.
- Produces: `createPaymentOrder` that accepts `projectId?: string | null` and stores `null` for user Billing purchases.

- [ ] **Step 1: Add a failing API behavior test**

```ts
expect(createPaymentOrder).toBeCalledWith(expect.objectContaining({ projectId: null }));
```

The API test must authenticate a user and post a payload with only `planId` and `customerEmail`.

- [ ] **Step 2: Run the target API test to verify it fails**

Run: `npx jest --runInBand tests/unit/payment`
Expected: FAIL because Checkout currently reads and authorizes `projectId`.

- [ ] **Step 3: Write minimal implementation**

Remove `getUserProjectRole` and `AuthorizationError` from the Checkout route. Pass `projectId: null` to payment creation; omit `projectId` from Stripe metadata and return URLs, and make both URLs target `/billing`.

```ts
success_url: `${siteUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
cancel_url: `${siteUrl}/payment/cancel?payment_id=${encodeURIComponent(paymentId)}`,
```

- [ ] **Step 4: Run target tests to verify they pass**

Run: `npx jest --runInBand tests/unit/payment`
Expected: PASS.

### Task 3: Add the global Billing route and remove project route

**Files:**
- Create: `src/app/(dashboard)/billing/page.tsx`
- Delete: `src/app/(dashboard)/[projectId]/billing/page.tsx`
- Modify: `src/components/billing/BillingPlansPage.tsx`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/lib/contexts/NavigationContext.tsx`
- Modify: `tests/unit/layout/recent-admin-nav.test.ts`

**Interfaces:**
- Produces: `BillingPlansPage` with no props and route `/billing`.
- Consumes: `/api/checkout` account-level payload from Tasks 1 and 2.

- [ ] **Step 1: Write failing navigation assertions**

```ts
expect(read('src/app/(dashboard)/billing/page.tsx')).toContain('BillingPlansPage');
expect(read('src/components/layout/TopBar.tsx')).toContain("router.push('/billing')");
expect(existsSync(path.join(process.cwd(), 'src/app/(dashboard)/[projectId]/billing/page.tsx'))).toBe(false);
```

- [ ] **Step 2: Run the layout test to verify it fails**

Run: `npx jest --runInBand tests/unit/layout/recent-admin-nav.test.ts`
Expected: FAIL because the global route does not exist and the old route still exists.

- [ ] **Step 3: Write minimal implementation**

Render `BillingPlansPage` at `/billing`, remove its `projectId` prop and the Checkout payload field, and make `handleBillingNavigation` unconditionally push `/billing`. Update Billing breadcrumb detection for the global path and remove the project-specific Billing route handling.

- [ ] **Step 4: Run layout test to verify it passes**

Run: `npx jest --runInBand tests/unit/layout/recent-admin-nav.test.ts`
Expected: PASS.

### Task 4: Verify the completed account Billing flow

**Files:**
- Modify: any files required by failed verification only.

- [ ] **Step 1: Run focused verification**

Run: `npx jest --runInBand tests/unit/payment/payment-domain.test.ts tests/unit/payment/supabase-payments.test.ts tests/unit/layout/recent-admin-nav.test.ts`
Expected: PASS.

- [ ] **Step 2: Run type and lint checks**

Run: `npm run typecheck && npx eslint src/app/api/checkout/route.ts src/components/billing/BillingPlansPage.tsx src/components/layout/TopBar.tsx src/lib/payment-domain.ts src/lib/supabase-payments.ts`
Expected: PASS.

- [ ] **Step 3: Inspect final changes**

Run: `git diff --check && git status --short`
Expected: no whitespace errors; only intended Billing implementation and planning files are listed.
